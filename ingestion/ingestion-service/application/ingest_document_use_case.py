import hashlib
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional, Callable, Awaitable
from datetime import datetime, timedelta, timezone

from domain.entities import Document, ChunkWithEmbedding
from domain.errors import EmptyDocumentError
from application.ports.i_document_parser import IDocumentParser
from application.ports.i_chunker import IChunker
from application.ports.i_embedding_service import IEmbeddingService
from application.ports.i_vector_store import IVectorStore
from application.ports.i_graph_service_client import IGraphServiceClient
from application.ports.i_document_repository import IDocumentRepository
try:
    from model_config import build_model_config
except ImportError:
    from ...model_config import build_model_config  # type: ignore

_MAX_VERSIONS = int(os.getenv("MAX_VERSIONS_PER_DOCUMENT", "3"))

logger = logging.getLogger(__name__)


@dataclass
class IngestRequest:
    content: bytes
    filename: str
    mime_type: str
    source_url: Optional[str] = None
    content_source: str = "upload"  # upload | web | db | rss
    namespace: str = "default"
    expires_in_days: Optional[int] = None  # None = never expires


@dataclass
class IngestResult:
    doc_id: str
    chunk_count: int


@dataclass
class PreviewStage:
    stage: str
    fired: bool
    latency_ms: float = 0.0
    meta: dict = field(default_factory=dict)


@dataclass
class PreviewChunk:
    chunk_id: str
    sequence_index: int
    chunk_type: str
    text_snippet: str
    char_count: int
    token_count: int
    parent_chunk_id: Optional[str] = None
    embedding_dims: int = 0


@dataclass
class PreviewEntity:
    id: str
    label: str
    name: str
    source_doc_ids: list[str]


@dataclass
class PreviewRelation:
    id: str
    source_entity_id: str
    target_entity_id: str
    relation_type: str
    source_doc_id: str


@dataclass
class PreviewStorageAction:
    target: str
    action: str
    reason: str


@dataclass
class IngestPreviewResult:
    preview_id: str
    filename: str
    namespace: str
    mime_type: str
    content_source: str
    source_url: Optional[str]
    source_hash: str
    duplicate_detected: bool
    duplicate_document_id: Optional[str]
    dry_run: bool
    raw_chars: int
    parsed_chars: int
    chunk_count: int
    total_tokens: int
    parsed_preview: str
    stages: list[PreviewStage] = field(default_factory=list)
    chunks: list[PreviewChunk] = field(default_factory=list)
    graph_entities: list[PreviewEntity] = field(default_factory=list)
    graph_relations: list[PreviewRelation] = field(default_factory=list)
    storage_plan: list[PreviewStorageAction] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    chunker_strategy: str = "fixed"
    chunk_mode: str = "fixed"
    chunk_fallback_reason: str = ""
    embedding_provider: str = "ollama"
    embedding_model: str = ""
    graph_extraction_mode: str = "unknown"
    graph_extractor_backend: str = "unknown"
    graph_system_prompt_source: str = "unknown"
    graph_system_prompt_overridden: bool = False
    graph_llm_provider: str = "unknown"
    graph_llm_model: str = "unknown"


class IngestDocumentUseCase:
    def __init__(
        self,
        parser: IDocumentParser,
        chunker: IChunker,
        embedding_service: IEmbeddingService,
        vector_store: IVectorStore,
        document_repository: IDocumentRepository,
        graph_service_client: IGraphServiceClient,
        version_repository=None,
    ):
        self._parser = parser
        self._chunker = chunker
        self._embedding_service = embedding_service
        self._vector_store = vector_store
        self._document_repository = document_repository
        self._graph_service_client = graph_service_client
        self._version_repo = version_repository

    async def execute(
        self,
        request: IngestRequest,
        progress_cb: Optional[Callable[[int], Awaitable[None]]] = None,
    ) -> IngestResult:
        async def _progress(pct: int) -> None:
            if progress_cb:
                try:
                    await progress_cb(pct)
                except Exception:
                    pass

        # 1. Compute content hash for deduplication
        source_hash = hashlib.sha256(request.content).hexdigest()

        # 2. Parse content so graph extraction can still run even on exact duplicates.
        text, document = await self._parser.parse(request.content, request.filename, request.mime_type)
        await _progress(20)

        # 3. Check for existing document with same hash (skip vector reprocessing,
        #    but still rebuild graph so retries can recover from prior graph failures).
        existing = await self._document_repository.find_by_source_hash(
            source_hash, namespace=request.namespace
        )
        if existing:
            logger.info("Skipping duplicate document %s (same source_hash); rebuilding graph only", existing.id)
            await _progress(95)
            await self._trigger_graph_extraction(text, existing.id, request.namespace)
            await _progress(100)
            return IngestResult(doc_id=existing.id, chunk_count=existing.chunk_count)

        # 4. Set document metadata
        document.source_hash = source_hash
        document.source_url = request.source_url
        document.content_source = request.content_source
        document.namespace = request.namespace
        document.ingested_at = datetime.now(timezone.utc)
        if request.expires_in_days is not None:
            document.expires_at = datetime.now(timezone.utc) + timedelta(days=request.expires_in_days)

        # 5. Chunk text
        chunks = await self._chunker.chunk(text, document.id, request.namespace)
        if not chunks:
            raise EmptyDocumentError(f"No chunks produced for document: {request.filename}")
        await _progress(40)

        # 6. Embed chunks in batch
        texts = [c.text for c in chunks]
        embeddings = await self._embedding_service.embed_batch(texts)
        await _progress(70)

        # 7. Build ChunkWithEmbedding list (stamp with doc-level temporal metadata)
        chunks_with_embeddings = [
            ChunkWithEmbedding(
                chunk=chunk,
                embedding=embedding,
                ingested_at=document.ingested_at,
                expires_at=document.expires_at,
                content_source=document.content_source,
            )
            for chunk, embedding in zip(chunks, embeddings)
        ]

        # 8. Upsert to vector store
        await self._vector_store.upsert(chunks_with_embeddings, request.namespace)
        await _progress(90)

        # 9. Save document metadata
        document.chunk_count = len(chunks)
        await self._document_repository.save(document)
        await self._document_repository.update_chunk_count(document.id, len(chunks))

        # 10. Create version record and prune old versions
        if self._version_repo:
            try:
                next_ver = await self._version_repo.next_version(document.id)
                ver = await self._version_repo.create_version(
                    document.id, next_ver, len(chunks)
                )
                await self._version_repo.set_active(document.id, ver.id)
                await self._version_repo.prune_old_versions(document.id, _MAX_VERSIONS)
            except Exception as exc:
                logger.warning("Version tracking failed for %s: %s", document.id, exc)

        # 11. Trigger entity extraction and wait for it so job completion means
        #     vector + graph are both durably handled.
        await _progress(95)
        await self._trigger_graph_extraction(text, document.id, request.namespace)
        await _progress(100)
        return IngestResult(doc_id=document.id, chunk_count=len(chunks))

    async def preview(
        self,
        request: IngestRequest,
    ) -> IngestPreviewResult:
        """Run the ingestion pipeline in dry-run mode and return a preview artifact."""
        preview_id = f"preview-{hashlib.sha1(request.content).hexdigest()[:12]}"
        source_hash = hashlib.sha256(request.content).hexdigest()
        cfg = build_model_config()
        stages: list[PreviewStage] = []
        warnings: list[str] = []

        stages.append(PreviewStage(
            stage="input",
            fired=True,
            latency_ms=0.0,
            meta={
                "bytes": len(request.content),
                "filename": request.filename,
                "mime_type": request.mime_type,
            },
        ))

        t = time.monotonic()
        text, document = await self._parser.parse(request.content, request.filename, request.mime_type)
        parse_ms = (time.monotonic() - t) * 1000
        stages.append(PreviewStage(
            stage="parse",
            fired=True,
            latency_ms=parse_ms,
            meta={
                "bytes": len(request.content),
                "parsed_chars": len(text),
                "filename": request.filename,
                "mime_type": request.mime_type,
                "namespace": request.namespace,
                "duplicate_detected": False,
            },
        ))

        duplicate = await self._document_repository.find_by_source_hash(
            source_hash, namespace=request.namespace
        )
        if duplicate:
            warnings.append(
                f"Duplicate source hash detected for document {duplicate.id}; live ingest would skip vector reprocessing."
            )
            stages[-1].meta["duplicate_detected"] = True
            stages[-1].meta["duplicate_document_id"] = duplicate.id

        t = time.monotonic()
        chunks = await self._chunker.chunk(text, document.id, request.namespace)
        chunk_ms = (time.monotonic() - t) * 1000
        if not chunks:
            raise EmptyDocumentError(f"No chunks produced for preview: {request.filename}")
        chunk_mode = getattr(self._chunker, "last_chunk_mode", os.getenv("CHUNKER_STRATEGY", "fixed"))
        chunk_fallback_reason = getattr(self._chunker, "last_chunk_fallback_reason", "")
        stages.append(PreviewStage(
            stage="chunk",
            fired=True,
            latency_ms=chunk_ms,
            meta={
                "chunk_count": len(chunks),
                "chunker_strategy": os.getenv("CHUNKER_STRATEGY", "fixed"),
                "chunk_mode": chunk_mode,
                "chunk_fallback_reason": chunk_fallback_reason,
                "semantic_chunk_max_tokens": int(os.getenv("SEMANTIC_CHUNK_MAX_TOKENS", "256")),
                "semantic_chunk_similarity_threshold": float(os.getenv("SEMANTIC_CHUNK_SIMILARITY_THRESHOLD", "0.65")),
                "total_tokens": sum(c.token_count for c in chunks),
            },
        ))

        texts = [c.text for c in chunks]
        t = time.monotonic()
        embeddings = await self._embedding_service.embed_batch(texts)
        embed_ms = (time.monotonic() - t) * 1000
        stages.append(PreviewStage(
            stage="embed",
            fired=True,
            latency_ms=embed_ms,
            meta={
                "embedded_chunks": len(embeddings),
                "embedding_provider": cfg["embedding_provider"],
                "embedding_model": cfg["embedding_model"],
            },
        ))

        t = time.monotonic()
        graph_payload = await self._graph_service_client.extract_entities(
            text,
            preview_id,
            namespace=request.namespace,
            dry_run=True,
        )
        graph_payload = graph_payload or {}
        graph_ms = (time.monotonic() - t) * 1000
        graph_extraction_mode = str(graph_payload.get("extraction_mode", "unknown"))
        graph_extractor_backend = str(graph_payload.get("graph_extractor_backend", os.getenv("GRAPH_EXTRACTOR_BACKEND", "llm")))
        graph_system_prompt_source = str(graph_payload.get("graph_system_prompt_source", "unknown"))
        graph_system_prompt_overridden = bool(graph_payload.get("graph_system_prompt_overridden", False))
        graph_llm_provider = str(graph_payload.get("graph_provider", cfg["graph_llm_provider"]))
        graph_llm_model = str(graph_payload.get("graph_model", cfg["graph_llm_model"]))
        stages.append(PreviewStage(
            stage="graph",
            fired=True,
            latency_ms=graph_ms,
            meta={
                "entity_count": graph_payload.get("entity_count", 0),
                "relation_count": graph_payload.get("relation_count", 0),
                "graph_stored": graph_payload.get("graph_stored", False),
                "dry_run": True,
                "extraction_mode": graph_extraction_mode,
                "heuristic_blocks": graph_payload.get("heuristic_blocks", 0),
                "llm_blocks": graph_payload.get("llm_blocks", 0),
                "total_blocks": graph_payload.get("total_blocks", 0),
                "graph_extractor_backend": graph_extractor_backend,
                "graph_system_prompt_source": graph_system_prompt_source,
                "graph_system_prompt_overridden": graph_system_prompt_overridden,
                "graph_provider": graph_llm_provider,
                "graph_model": graph_llm_model,
            },
        ))

        stages.append(PreviewStage(
            stage="persist",
            fired=False,
            latency_ms=0.0,
            meta={
                "dry_run": True,
                "would_write": ["postgres", "chroma", "neo4j"],
                "targets": ["postgres metadata", "chroma vectors", "neo4j graph"],
            },
        ))

        storage_plan = [
            PreviewStorageAction(target="postgres metadata", action="skip", reason="dry_run preview"),
            PreviewStorageAction(target="chroma vectors", action="skip", reason="dry_run preview"),
            PreviewStorageAction(target="neo4j graph", action="skip", reason="dry_run preview"),
        ]
        if duplicate:
            storage_plan[1] = PreviewStorageAction(
                target="chroma vectors",
                action="skip",
                reason="duplicate document would normally skip vector reprocessing",
            )
            storage_plan[2] = PreviewStorageAction(
                target="neo4j graph",
                action="rebuild-only",
                reason="duplicate document would rebuild graph only in the live pipeline",
            )

        graph_entities = [
            PreviewEntity(
                id=e.get("id", ""),
                label=e.get("label", ""),
                name=e.get("name", ""),
                source_doc_ids=list(e.get("source_doc_ids", []) or []),
            )
            for e in graph_payload.get("entities", [])
            if isinstance(e, dict)
        ]
        graph_relations = [
            PreviewRelation(
                id=r.get("id", ""),
                source_entity_id=r.get("source_entity_id", ""),
                target_entity_id=r.get("target_entity_id", ""),
                relation_type=r.get("relation_type", ""),
                source_doc_id=r.get("source_doc_id", ""),
            )
            for r in graph_payload.get("relations", [])
            if isinstance(r, dict)
        ]

        preview_chunks = [
            PreviewChunk(
                chunk_id=chunk.id,
                sequence_index=chunk.sequence_index,
                chunk_type=chunk.chunk_type,
                text_snippet=chunk.text[:240],
                char_count=len(chunk.text),
                token_count=chunk.token_count,
                parent_chunk_id=chunk.parent_chunk_id,
                embedding_dims=len(embeddings[idx]) if idx < len(embeddings) else 0,
            )
            for idx, chunk in enumerate(chunks)
        ]

        if os.getenv("CHUNKER_STRATEGY", "fixed") == "semantic":
            warnings.append("Semantic chunker may fall back to structural splitting if embeddings are unavailable.")

        return IngestPreviewResult(
            preview_id=preview_id,
            filename=request.filename,
            namespace=request.namespace,
            mime_type=request.mime_type,
            content_source=request.content_source,
            source_url=request.source_url,
            source_hash=source_hash,
            duplicate_detected=bool(duplicate),
            duplicate_document_id=duplicate.id if duplicate else None,
            dry_run=True,
            raw_chars=len(request.content),
            parsed_chars=len(text),
            chunk_count=len(chunks),
            total_tokens=sum(c.token_count for c in chunks),
            parsed_preview=text[:4000],
            stages=stages,
            chunks=preview_chunks,
            graph_entities=graph_entities,
            graph_relations=graph_relations,
            storage_plan=storage_plan,
            warnings=warnings,
            chunker_strategy=os.getenv("CHUNKER_STRATEGY", "fixed"),
            chunk_mode=chunk_mode,
            chunk_fallback_reason=chunk_fallback_reason,
            embedding_provider=cfg["embedding_provider"],
            embedding_model=cfg["embedding_model"],
            graph_extraction_mode=graph_extraction_mode,
            graph_extractor_backend=graph_extractor_backend,
            graph_system_prompt_source=graph_system_prompt_source,
            graph_system_prompt_overridden=graph_system_prompt_overridden,
            graph_llm_provider=graph_llm_provider,
            graph_llm_model=graph_llm_model,
        )

    async def _trigger_graph_extraction(self, text: str, document_id: str,
                                        namespace: str) -> None:
        try:
            await self._graph_service_client.extract_entities(text, document_id, namespace=namespace)
        except Exception as e:
            logger.warning(f"Graph extraction failed for document {document_id}: {e}")
