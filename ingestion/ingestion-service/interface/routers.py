"""
FastAPI router for the Ingestion Service.
"""
import logging
import mimetypes
import uuid
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

try:
    # รองรับการ import ได้ทั้งตอนรันใน package และตอนรันตรง ๆ
    from domain.errors import CorruptedFileError, EmptyDocumentError, UnsupportedFileFormatError
    from interface.dependencies import get_doc_repo, get_vector_store, get_job_queue, get_version_repo, get_ingest_use_case
    from infrastructure.adapters.job_queue import IngestionJob
    from infrastructure.adapters.parser_factory import ParserFactory
    from application.ingest_document_use_case import IngestRequest
except ImportError:
    from ..domain.errors import CorruptedFileError, EmptyDocumentError, UnsupportedFileFormatError
    from .dependencies import get_doc_repo, get_vector_store, get_job_queue, get_version_repo, get_ingest_use_case
    from ..infrastructure.adapters.job_queue import IngestionJob
    from ..infrastructure.adapters.parser_factory import ParserFactory
    from ..application.ingest_document_use_case import IngestRequest

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------

# Request body สำหรับ ingest จากข้อความโดยตรง
class IngestTextRequest(BaseModel):
    text: str
    filename: str = "document.txt"
    namespace: str = "default"
    content_source: str = "upload"
    source_url: Optional[str] = None
    expires_in_days: Optional[int] = None


# Request body สำหรับ preview จากข้อความโดยตรง
class IngestPreviewTextRequest(BaseModel):
    text: str
    filename: str = "document.txt"
    namespace: str = "default"
    content_source: str = "upload"
    source_url: Optional[str] = None
    expires_in_days: Optional[int] = None
    mime_type: str = "text/plain"


# Response เมื่อ enqueue งานสำเร็จ
class JobQueuedResponse(BaseModel):
    job_id: str
    status: str = "queued"


# Response สำหรับ action ที่เปลี่ยนสถานะ job
class JobActionResponse(BaseModel):
    job_id: str
    status: str


# Response สำหรับดูสถานะงาน ingestion
class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = 0
    error: Optional[str] = None


# รายการ job 1 รายการในหน้ารายการทั้งหมด
class JobListItemResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    filename: str
    mime_type: str
    namespace: str
    content_source: str
    source_url: Optional[str] = None
    retry_count: int
    max_retries: int
    error: Optional[str] = None
    created_at: float
    updated_at: float


# Response แบบ pagination สำหรับ list jobs
class JobListResponse(BaseModel):
    items: list[JobListItemResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# Preview แบบอ่านง่ายของข้อมูลต้นฉบับที่ถูก queue เข้ามา
class JobPreviewResponse(BaseModel):
    job_id: str
    filename: str
    namespace: str
    mime_type: str
    content_source: str
    content_kind: str
    total_bytes: int
    preview_text: str
    truncated: bool = False


# สถานะของแต่ละ stage ตอน preview ingest
class PreviewStageResponse(BaseModel):
    stage: str
    fired: bool
    latency_ms: float = 0.0
    meta: dict = Field(default_factory=dict)


# รายละเอียด chunk ที่ได้จาก preview
class PreviewChunkResponse(BaseModel):
    chunk_id: str
    sequence_index: int
    chunk_type: str
    text_snippet: str
    char_count: int
    token_count: int
    parent_chunk_id: Optional[str] = None
    embedding_dims: int = 0


# เอนทิตีที่ระบบ graph ตรวจพบใน preview
class PreviewEntityResponse(BaseModel):
    id: str
    label: str
    name: str
    source_doc_ids: list[str] = Field(default_factory=list)


# ความสัมพันธ์ระหว่างเอนทิตีใน graph preview
class PreviewRelationResponse(BaseModel):
    id: str
    source_entity_id: str
    target_entity_id: str
    relation_type: str
    source_doc_id: str


# สิ่งที่ระบบจะเก็บหรือไม่เก็บใน preview
class PreviewStorageActionResponse(BaseModel):
    target: str
    action: str
    reason: str


# Response หลักของ preview ingestion
class IngestPreviewResponse(BaseModel):
    preview_id: str
    filename: str
    namespace: str
    mime_type: str
    content_source: str
    source_url: Optional[str] = None
    source_hash: str
    duplicate_detected: bool
    duplicate_document_id: Optional[str] = None
    dry_run: bool = True
    raw_chars: int
    parsed_chars: int
    chunk_count: int
    total_tokens: int
    parsed_preview: str
    stages: list[PreviewStageResponse] = Field(default_factory=list)
    chunks: list[PreviewChunkResponse] = Field(default_factory=list)
    graph_entities: list[PreviewEntityResponse] = Field(default_factory=list)
    graph_relations: list[PreviewRelationResponse] = Field(default_factory=list)
    storage_plan: list[PreviewStorageActionResponse] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    chunker_strategy: str = "fixed"
    chunk_mode: str = "fixed"
    chunk_fallback_reason: str = ""
    embedding_provider: str = "ollama"
    embedding_model: str = ""
    graph_extraction_mode: str = "unknown"


# Response สำหรับการ extract text จากไฟล์
class FileExtractResponse(BaseModel):
    filename: str
    mime_type: str
    extracted_text: str
    char_count: int


# สรุปสถานะ queue ทั้งระบบ
class QueueStatsResponse(BaseModel):
    queue_depth: int
    processing: int
    failed_total: int
    recent_failures: list


# response health check
class HealthResponse(BaseModel):
    status: str
    service: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _detect_mime_type(upload: UploadFile) -> str:
    # ถ้า client ส่ง content-type มาและไม่ใช่ค่า generic ให้ใช้ค่านั้นก่อน
    if upload.content_type and upload.content_type not in ("application/octet-stream", ""):
        return upload.content_type
    # ถ้าไม่มีหรือเป็น generic ให้เดาจากนามสกุลไฟล์แทน
    guessed, _ = mimetypes.guess_type(upload.filename or "")
    return guessed or "application/octet-stream"


async def _build_preview_response(
    *,
    content: bytes,
    filename: str,
    mime_type: str,
    namespace: str,
    content_source: str,
    source_url: Optional[str],
    expires_in_days: Optional[int],
    use_case,
) -> IngestPreviewResponse:
    # เรียก use case ฝั่ง application เพื่อคำนวณ preview จริงของ ingestion
    result = await use_case.preview(
        IngestRequest(
            content=content,
            filename=filename,
            mime_type=mime_type,
            source_url=source_url,
            content_source=content_source,
            namespace=namespace,
            expires_in_days=expires_in_days,
        )
    )
    return IngestPreviewResponse.model_validate(asdict(result))


@router.post("/ingest/extract", response_model=FileExtractResponse)
async def extract_file_text(
    file: UploadFile = File(...),
):
    # อ่านไฟล์แล้วดึงข้อความออกมาแบบไม่ enqueue job
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail={"error": "Uploaded file is empty"})
    mime_type = _detect_mime_type(file)
    # ใช้ parser factory เพื่อเลือก parser ให้ตรงกับชนิดไฟล์
    parser = ParserFactory.create()
    text, _ = await parser.parse(content, file.filename or "upload", mime_type)
    return FileExtractResponse(
        filename=file.filename or "upload",
        mime_type=mime_type,
        extracted_text=text,
        char_count=len(text),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED,
             response_model=JobQueuedResponse)
async def ingest_file(
    file: UploadFile = File(...),
    queue=Depends(get_job_queue),
):
    """Enqueue a document via multipart file upload. Returns job_id immediately."""
    # รับไฟล์, ตรวจว่าไฟล์ไม่ว่าง, แล้วสร้าง job เข้า queue ทันที
    mime_type = _detect_mime_type(file)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail={"error": "Uploaded file is empty"})

    # เก็บ binary ของไฟล์ในรูป base64 เพื่อส่งผ่าน Redis ได้
    job = IngestionJob(
        job_id=str(uuid.uuid4()),
        status="queued",
        progress=0,
        content_b64=IngestionJob.encode_content(content),
        filename=file.filename or "upload",
        mime_type=mime_type,
    )
    await queue.enqueue(job)
    return JobQueuedResponse(job_id=job.job_id)


@router.post("/ingest/text", status_code=status.HTTP_202_ACCEPTED,
             response_model=JobQueuedResponse)
async def ingest_text(
    body: IngestTextRequest,
    queue=Depends(get_job_queue),
):
    """Enqueue a document via JSON body. Returns job_id immediately."""
    # รับข้อความ raw แล้วแปลงเป็น bytes ก่อนส่งเข้า queue
    if not body.text.strip():
        raise HTTPException(status_code=400, detail={"error": "Text content is empty"})

    content = body.text.encode("utf-8")
    # สร้าง job แบบเดียวกับ ingest จากไฟล์ แต่ต้นทางเป็นข้อความ
    job = IngestionJob(
        job_id=str(uuid.uuid4()),
        status="queued",
        progress=0,
        content_b64=IngestionJob.encode_content(content),
        filename=body.filename,
        mime_type="text/plain",
        namespace=body.namespace,
        content_source=body.content_source,
        source_url=body.source_url,
        expires_in_days=body.expires_in_days,
    )
    await queue.enqueue(job)
    return JobQueuedResponse(job_id=job.job_id)


@router.post("/ingest/preview/text", response_model=IngestPreviewResponse)
async def preview_ingest_text(
    body: IngestPreviewTextRequest,
    use_case=Depends(get_ingest_use_case),
):
    # preview จะไม่ enqueue งาน แต่จะจำลอง pipeline ให้ดูผลลัพธ์ก่อน
    if not body.text.strip():
        raise HTTPException(status_code=400, detail={"error": "Text content is empty"})
    return await _build_preview_response(
        content=body.text.encode("utf-8"),
        filename=body.filename,
        mime_type=body.mime_type,
        namespace=body.namespace,
        content_source=body.content_source,
        source_url=body.source_url,
        expires_in_days=body.expires_in_days,
        use_case=use_case,
    )


@router.post("/ingest/preview", response_model=IngestPreviewResponse)
async def preview_ingest_file(
    file: UploadFile = File(...),
    namespace: str = Form("default"),
    content_source: str = Form("upload"),
    source_url: Optional[str] = Form(None),
    expires_in_days: Optional[int] = Form(None),
    use_case=Depends(get_ingest_use_case),
):
    # preview สำหรับไฟล์อัปโหลดแบบ multipart form
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail={"error": "Uploaded file is empty"})
    mime_type = _detect_mime_type(file)
    return await _build_preview_response(
        content=content,
        filename=file.filename or "upload",
        mime_type=mime_type,
        namespace=namespace,
        content_source=content_source,
        source_url=source_url,
        expires_in_days=expires_in_days,
        use_case=use_case,
    )


@router.get("/ingest/status/{job_id}", response_model=JobStatusResponse)
async def get_ingest_status(job_id: str, queue=Depends(get_job_queue)):
    """Return current status and progress of an ingestion job."""
    # ดึงสถานะล่าสุดของ job จาก Redis
    job = await queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        progress=job.progress,
        error=job.error,
    )


@router.get("/ingest/jobs/{job_id}/preview", response_model=JobPreviewResponse)
async def preview_job(job_id: str, queue=Depends(get_job_queue)):
    """Return a human-readable preview of the original queued input."""
    # เอาข้อมูลดิบที่เคย enqueue ไว้มาดูเป็นข้อความอ่านง่าย
    job = await queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    raw = job.content
    total_bytes = len(raw)
    try:
        # ถ้า decode ได้ แปลว่าเป็น text ปกติ
        text = raw.decode("utf-8")
        content_kind = "text"
    except UnicodeDecodeError:
        # ถ้า decode ไม่ได้ ให้แสดงแบบแทนค่าอักขระเสีย
        text = raw.decode("utf-8", errors="replace")
        content_kind = "binary_or_encoded"

    # จำกัดความยาว preview เพื่อไม่ให้ response ใหญ่เกินไป
    preview_limit = 4000
    truncated = len(text) > preview_limit
    preview_text = text[:preview_limit]
    return JobPreviewResponse(
        job_id=job.job_id,
        filename=job.filename,
        namespace=job.namespace,
        mime_type=job.mime_type,
        content_source=job.content_source,
        content_kind=content_kind,
        total_bytes=total_bytes,
        preview_text=preview_text,
        truncated=truncated,
    )


@router.get("/ingest/queue/stats", response_model=QueueStatsResponse)
async def queue_stats(queue=Depends(get_job_queue)):
    """Return queue depth, processing count, and recent failures."""
    # ดึงสรุปสถิติ queue จาก adapter ฝั่ง Redis
    stats = await queue.queue_stats()
    return QueueStatsResponse(**stats)


@router.get("/ingest/jobs", response_model=JobListResponse)
async def list_jobs(
    page: int = 1,
    page_size: int = 20,
    sort: str = "latest",
    status: Optional[str] = None,
    namespace: Optional[str] = None,
    query: Optional[str] = None,
    queue=Depends(get_job_queue),
):
    """Return paginated jobs with optional filters."""
    # query job จาก queue แล้วแปลงเป็น response ที่ frontend ใช้งานง่าย
    page_data = await queue.list_jobs(
        page=page,
        page_size=page_size,
        sort=sort,
        status=status,
        namespace=namespace,
        query=query,
    )
    total_pages = max(1, (page_data.total + page_data.page_size - 1) // page_data.page_size)
    return JobListResponse(
        items=[
            JobListItemResponse(
                job_id=j.job_id,
                status=j.status,
                progress=j.progress,
                filename=j.filename,
                mime_type=j.mime_type,
                namespace=j.namespace,
                content_source=j.content_source,
                source_url=j.source_url,
                retry_count=j.retry_count,
                max_retries=j.max_retries,
                error=j.error,
                created_at=j.created_at,
                updated_at=j.updated_at,
            )
            for j in page_data.items
        ],
        total=page_data.total,
        page=page_data.page,
        page_size=page_data.page_size,
        total_pages=total_pages,
    )


@router.post("/ingest/{job_id}/retry", response_model=JobQueuedResponse)
async def retry_job(job_id: str, queue=Depends(get_job_queue)):
    """Admin retry: reset retry_count and re-enqueue a failed job."""
    # retry ได้เฉพาะ job ที่ล้มเหลวหรือยังอยู่ในคิว
    job = await queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("failed", "queued"):
        raise HTTPException(status_code=409, detail=f"Job is {job.status}, cannot retry")
    job.retry_count = 0
    job.status = "queued"
    await queue.re_enqueue(job)
    return JobQueuedResponse(job_id=job.job_id)


@router.post("/ingest/{job_id}/cancel", response_model=JobActionResponse)
async def cancel_job(job_id: str, queue=Depends(get_job_queue)):
    """Cancel a queued or in-flight job."""
    # ยกเลิกได้เฉพาะงานที่ยังไม่เสร็จ
    job = await queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("queued", "processing", "processing_graph"):
        raise HTTPException(status_code=409, detail=f"Job is {job.status}, cannot cancel")
    cancelled = await queue.cancel_job(job_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobActionResponse(job_id=cancelled.job_id, status=cancelled.status)


@router.post("/ingest/{job_id}/reprocess", response_model=JobQueuedResponse)
async def reprocess_job(job_id: str, queue=Depends(get_job_queue)):
    """Clone a completed or cancelled job into a fresh queued job."""
    # สร้าง job ใหม่จากข้อมูลเดิม เพื่อรันซ้ำโดยไม่ทับ job เดิม
    job = await queue.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("done", "failed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Job is {job.status}, cannot reprocess")
    cloned = await queue.reprocess_job(job_id)
    if not cloned:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobQueuedResponse(job_id=cloned.job_id)


@router.delete("/documents/{document_id}", status_code=status.HTTP_200_OK)
async def delete_document(
    document_id: str,
    namespace: str = "default",
    doc_repo=Depends(get_doc_repo),
    vector_store=Depends(get_vector_store),
):
    """Delete a document from postgres metadata and ChromaDB vectors."""
    # ลบทั้ง metadata ในฐานข้อมูลและ vector embeddings ใน ChromaDB
    doc = await doc_repo.find_by_id(document_id, namespace=namespace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await vector_store.delete_by_document_id(document_id, namespace=doc.namespace)
    await doc_repo.delete(document_id, namespace=namespace)
    return {"status": "deleted", "document_id": document_id, "namespace": namespace}


@router.get("/documents/{document_id}/versions")
async def list_document_versions(
    document_id: str,
    version_repo=Depends(get_version_repo),
):
    """List all versions of a document ordered newest first."""
    # ดึง version history ของเอกสารเพื่อให้ย้อนดูได้
    versions = await version_repo.list_versions(document_id)
    return [
        {
            "id": v.id,
            "document_id": v.document_id,
            "version": v.version,
            "ingested_at": v.ingested_at.isoformat() if v.ingested_at else None,
            "chunk_count": v.chunk_count,
            "is_active": v.is_active,
        }
        for v in versions
    ]


@router.post("/documents/{document_id}/rollback/{version_id}", status_code=status.HTTP_200_OK)
async def rollback_document_version(
    document_id: str,
    version_id: str,
    version_repo=Depends(get_version_repo),
    vector_store=Depends(get_vector_store),
    doc_repo=Depends(get_doc_repo),
):
    """Restore a previous version as the active version and invalidate cache."""
    # ตรวจว่า version นี้เป็นของ document จริงก่อน rollback
    ver = await version_repo.get_version_by_id(version_id)
    if not ver or ver.document_id != document_id:
        raise HTTPException(status_code=404, detail="Version not found")

    # ตั้ง version นี้ให้เป็น active และอัปเดต chunk_count ให้ตรงกับ version ใหม่
    await version_repo.set_active(document_id, version_id)
    # Update chunk_count on document metadata to reflect rolled-back version
    await doc_repo.update_chunk_count(document_id, ver.chunk_count)

    return {
        "status": "rolled_back",
        "document_id": document_id,
        "active_version": ver.version,
        "chunk_count": ver.chunk_count,
    }


@router.get("/documents/{document_id}/chunks")
async def get_document_chunks(
    document_id: str,
    namespace: str = "default",
    doc_repo=Depends(get_doc_repo),
    vector_store=Depends(get_vector_store),
):
    """Return all stored chunks for a document from ChromaDB."""
    # ตรวจว่า document มีอยู่จริงก่อนค่อยดึง chunk
    doc = await doc_repo.find_by_id(document_id, namespace=namespace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        # ใช้ collection ของ namespace นั้น ๆ แล้ว query chunk ทั้งหมดของเอกสาร
        col = vector_store._get_or_create(namespace)
        results = col.get(
            where={"document_id": document_id},
            include=["metadatas", "documents"],
        )
        chunks = []
        for i, (cid, meta) in enumerate(zip(results["ids"], results["metadatas"])):
            # เอาข้อความจาก metadata ก่อน ถ้าไม่มีค่อย fallback ไปที่ documents
            text = meta.get("text", "") or (results.get("documents") or [""])[i] or ""
            chunks.append({
                "chunk_id": cid,
                "document_id": document_id,
                "sequence_index": meta.get("sequence_index", i),
                "text": text,
                "char_count": len(text),
            })
        chunks.sort(key=lambda c: c["sequence_index"])
        return {"document_id": document_id, "namespace": namespace,
                "chunk_count": len(chunks), "chunks": chunks}
    except Exception as exc:
        # ถ้า query ฝั่ง vector store พัง ให้ส่งเป็น 500 พร้อมข้อความ error เดิม
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/health", response_model=HealthResponse)
async def health():
    # endpoint health check แบบง่าย เพื่อให้ระบบอื่น probe ได้
    return HealthResponse(status="healthy", service="ingestion-service")
