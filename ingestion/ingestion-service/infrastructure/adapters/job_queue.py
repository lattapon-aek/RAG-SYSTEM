"""
Redis-based async ingestion job queue (Task 19).

Queue list  : Redis List  'ingestion:queue'       (LPUSH/BRPOP)
Job metadata: Redis Hash  'ingestion:job:{job_id}' (TTL 7 days)
"""
import base64
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

_QUEUE_KEY = "ingestion:queue"
_JOB_KEY_PREFIX = "ingestion:job:"
_JOB_TTL = 7 * 24 * 3600          # 7 days in seconds
_DEFAULT_MAX_RETRIES = int(os.getenv("INGESTION_MAX_RETRIES", "3"))


# ---------------------------------------------------------------------------
# Domain object
# ---------------------------------------------------------------------------

@dataclass
class IngestionJob:
    job_id: str
    status: str               # queued | processing | processing_graph | cancelled | done | failed
    progress: int             # 0-100
    content_b64: str          # base64-encoded raw bytes
    filename: str
    mime_type: str
    namespace: str = "default"
    content_source: str = "upload"
    source_url: Optional[str] = None
    expires_in_days: Optional[int] = None
    retry_count: int = 0
    max_retries: int = _DEFAULT_MAX_RETRIES
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def content(self) -> bytes:
        return base64.b64decode(self.content_b64)

    @staticmethod
    def encode_content(raw: bytes) -> str:
        return base64.b64encode(raw).decode("ascii")


@dataclass
class JobListPage:
    items: list[IngestionJob]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Queue adapter
# ---------------------------------------------------------------------------

class IngestionJobQueue:
    """Async Redis-backed job queue for ingestion tasks."""

    def __init__(self, redis_url: str = "redis://redis:6379/0"):
        self._redis_url = redis_url
        self._client = None

    async def _get_client(self):
        if self._client is None:
            import redis.asyncio as aioredis
            self._client = await aioredis.from_url(
                self._redis_url, decode_responses=True
            )
        return self._client

    async def enqueue(self, job: IngestionJob) -> None:
        """Persist job metadata and push job_id onto the queue list."""
        client = await self._get_client()
        job_key = f"{_JOB_KEY_PREFIX}{job.job_id}"
        mapping = {
            "job_id": job.job_id,
            "status": job.status,
            "progress": str(job.progress),
            "content_b64": job.content_b64,
            "filename": job.filename,
            "mime_type": job.mime_type,
            "namespace": job.namespace,
            "content_source": job.content_source,
            "source_url": job.source_url or "",
            "expires_in_days": "" if job.expires_in_days is None else str(job.expires_in_days),
            "retry_count": str(job.retry_count),
            "max_retries": str(job.max_retries),
            "error": job.error or "",
            "created_at": str(job.created_at),
            "updated_at": str(job.updated_at),
        }
        async with client.pipeline(transaction=True) as pipe:
            pipe.hset(job_key, mapping=mapping)
            pipe.expire(job_key, _JOB_TTL)
            pipe.lpush(_QUEUE_KEY, job.job_id)
            await pipe.execute()
        logger.debug("Enqueued job %s (%s)", job.job_id, job.filename)

    async def dequeue(self, timeout: int = 5) -> Optional[IngestionJob]:
        """Block-pop one job_id and return the full IngestionJob (or None on timeout)."""
        client = await self._get_client()
        result = await client.brpop(_QUEUE_KEY, timeout=timeout)
        if not result:
            return None
        _, job_id = result
        return await self.get_job(job_id)

    async def get_job(self, job_id: str) -> Optional[IngestionJob]:
        client = await self._get_client()
        data = await client.hgetall(f"{_JOB_KEY_PREFIX}{job_id}")
        if not data:
            return None
        return IngestionJob(
            job_id=data["job_id"],
            status=data["status"],
            progress=int(data.get("progress", "0")),
            content_b64=data["content_b64"],
            filename=data["filename"],
            mime_type=data["mime_type"],
            namespace=data.get("namespace", "default"),
            content_source=data.get("content_source", "upload"),
            source_url=data.get("source_url") or None,
            expires_in_days=(
                int(data["expires_in_days"])
                if data.get("expires_in_days") not in (None, "")
                else None
            ),
            retry_count=int(data.get("retry_count", "0")),
            max_retries=int(data.get("max_retries", str(_DEFAULT_MAX_RETRIES))),
            error=data.get("error") or None,
            created_at=float(data.get("created_at", "0")),
            updated_at=float(data.get("updated_at", "0")),
        )

    async def update_status(
        self,
        job_id: str,
        status: str,
        progress: int,
        error: Optional[str] = None,
    ) -> None:
        client = await self._get_client()
        job_key = f"{_JOB_KEY_PREFIX}{job_id}"
        current_status = await client.hget(job_key, "status")
        if current_status == "cancelled" and status != "cancelled":
            logger.debug("Skip status update for cancelled job %s -> %s", job_id, status)
            return
        mapping: dict = {
            "status": status,
            "progress": str(progress),
            "updated_at": str(time.time()),
        }
        if error is not None:
            mapping["error"] = error
        await client.hset(job_key, mapping=mapping)
        await client.expire(job_key, _JOB_TTL)

    async def re_enqueue(self, job: IngestionJob) -> None:
        """Update retry_count then push back to the queue."""
        client = await self._get_client()
        job_key = f"{_JOB_KEY_PREFIX}{job.job_id}"
        await client.hset(job_key, mapping={
            "status": "queued",
            "retry_count": str(job.retry_count),
            "progress": "0",
            "error": "",
            "updated_at": str(time.time()),
        })
        await client.lpush(_QUEUE_KEY, job.job_id)
        logger.info("Re-enqueued job %s (attempt %d)", job.job_id, job.retry_count)

    async def remove_from_queue(self, job_id: str) -> int:
        """Remove a job id from the Redis queue list."""
        client = await self._get_client()
        removed = await client.lrem(_QUEUE_KEY, 0, job_id)
        return int(removed or 0)

    async def cancel_job(self, job_id: str) -> Optional[IngestionJob]:
        """Mark an existing job as cancelled and remove it from the queue if present."""
        job = await self.get_job(job_id)
        if not job:
            return None
        await self.remove_from_queue(job_id)
        await self.update_status(job_id, "cancelled", job.progress or 0)
        return await self.get_job(job_id)

    async def reprocess_job(self, job_id: str) -> Optional[IngestionJob]:
        """Clone an existing job into a fresh queued job with a new job id."""
        job = await self.get_job(job_id)
        if not job:
            return None
        new_job = IngestionJob(
            job_id=str(uuid.uuid4()),
            status="queued",
            progress=0,
            content_b64=job.content_b64,
            filename=job.filename,
            mime_type=job.mime_type,
            namespace=job.namespace,
            content_source=job.content_source,
            source_url=job.source_url,
            expires_in_days=job.expires_in_days,
            retry_count=0,
            max_retries=job.max_retries,
        )
        await self.enqueue(new_job)
        logger.info("Reprocessed job %s into new job %s", job_id, new_job.job_id)
        return new_job

    async def queue_stats(self) -> dict:
        """Return queue depth, processing count, and recent failures."""
        client = await self._get_client()
        queue_depth = await client.llen(_QUEUE_KEY)
        processing = 0
        failed_total = 0
        recent_failures = []
        async for key in client.scan_iter(f"{_JOB_KEY_PREFIX}*"):
            status = await client.hget(key, "status")
            if status in {"processing", "processing_graph"}:
                processing += 1
            elif status == "failed":
                failed_total += 1
                filename = await client.hget(key, "filename") or ""
                error = await client.hget(key, "error") or ""
                job_id = key[len(_JOB_KEY_PREFIX):]
                recent_failures.append({"job_id": job_id, "filename": filename, "error": error})
        return {
            "queue_depth": queue_depth,
            "processing": processing,
            "failed_total": failed_total,
            "recent_failures": recent_failures[-5:],
        }

    async def list_jobs(
        self,
        page: int = 1,
        page_size: int = 20,
        sort: str = "latest",
        status: Optional[str] = None,
        namespace: Optional[str] = None,
        query: Optional[str] = None,
    ) -> JobListPage:
        """Return a paginated list of jobs with optional filters."""
        client = await self._get_client()
        jobs: list[IngestionJob] = []
        async for key in client.scan_iter(f"{_JOB_KEY_PREFIX}*"):
            job = await self.get_job(key[len(_JOB_KEY_PREFIX):])
            if not job:
                continue
            if status and job.status != status:
                continue
            if namespace and job.namespace != namespace:
                continue
            if query:
                needle = query.lower()
                haystack = " ".join([
                    job.job_id,
                    job.filename or "",
                    job.namespace or "",
                    job.status or "",
                    job.error or "",
                    job.source_url or "",
                ]).lower()
                if needle not in haystack:
                    continue
            jobs.append(job)

        reverse = sort != "oldest"
        jobs.sort(key=lambda j: (j.updated_at, j.created_at, j.job_id), reverse=reverse)
        page_size = max(1, min(page_size, 100))
        page = max(1, page)
        total = len(jobs)
        start = (page - 1) * page_size
        end = start + page_size
        return JobListPage(
            items=jobs[start:end],
            total=total,
            page=page,
            page_size=page_size,
        )

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
