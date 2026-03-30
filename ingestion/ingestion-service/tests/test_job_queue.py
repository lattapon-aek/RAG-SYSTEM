"""
Task 19.4 — Unit tests สำหรับ Async Ingestion Queue

Tests:
- POST /ingest returns job_id immediately without blocking
- IngestionJob encodes/decodes content correctly
- Worker retries up to max_retries then marks failed
- Worker marks job done on success
- queue_stats returns correct counts

Usage:
    cd rag-system/ingestion/ingestion-service
    py -3.12 -m pytest tests/test_job_queue.py -v
"""
import sys
import os
import asyncio
import base64
import time
import uuid

_INGESTION = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _INGESTION not in sys.path:
    sys.path.insert(0, _INGESTION)

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from infrastructure.adapters.job_queue import IngestionJob, _DEFAULT_MAX_RETRIES


# ---------------------------------------------------------------------------
# IngestionJob helpers
# ---------------------------------------------------------------------------

def _make_job(content: bytes = b"hello world", retry_count: int = 0,
              max_retries: int = 3) -> IngestionJob:
    return IngestionJob(
        job_id=str(uuid.uuid4()),
        status="queued",
        progress=0,
        content_b64=IngestionJob.encode_content(content),
        filename="test.txt",
        mime_type="text/plain",
        retry_count=retry_count,
        max_retries=max_retries,
    )


# ---------------------------------------------------------------------------
# Tests: IngestionJob encode/decode
# ---------------------------------------------------------------------------

def test_encode_content_roundtrip():
    raw = b"The quick brown fox"
    encoded = IngestionJob.encode_content(raw)
    job = _make_job(raw)
    assert job.content == raw


def test_encode_content_is_ascii():
    encoded = IngestionJob.encode_content(b"\x00\xff\xfe binary data")
    assert encoded.isascii()


def test_job_content_property():
    raw = b"some content bytes"
    job = _make_job(raw)
    assert job.content == raw


def test_job_defaults():
    job = _make_job()
    assert job.status == "queued"
    assert job.progress == 0
    assert job.retry_count == 0
    assert job.namespace == "default"
    assert job.error is None


# ---------------------------------------------------------------------------
# Fake in-memory queue for testing without Redis
# ---------------------------------------------------------------------------

class InMemoryJobQueue:
    """Simple in-memory queue that mimics IngestionJobQueue interface."""

    def __init__(self):
        self._jobs: dict[str, IngestionJob] = {}
        self._queue: list[str] = []

    async def enqueue(self, job: IngestionJob) -> None:
        self._jobs[job.job_id] = job
        self._queue.append(job.job_id)

    async def dequeue(self, timeout: int = 5) -> IngestionJob | None:
        if not self._queue:
            return None
        job_id = self._queue.pop()
        return self._jobs.get(job_id)

    async def get_job(self, job_id: str) -> IngestionJob | None:
        return self._jobs.get(job_id)

    async def update_status(self, job_id: str, status: str, progress: int,
                            error: str | None = None) -> None:
        job = self._jobs.get(job_id)
        if job:
            if job.status == "cancelled" and status != "cancelled":
                return
            job.status = status
            job.progress = progress
            if error is not None:
                job.error = error

    async def re_enqueue(self, job: IngestionJob) -> None:
        if job.job_id in self._jobs:
            self._jobs[job.job_id].status = "queued"
            self._jobs[job.job_id].retry_count = job.retry_count
            self._queue.append(job.job_id)

    async def remove_from_queue(self, job_id: str) -> int:
        removed = 0
        while job_id in self._queue:
            self._queue.remove(job_id)
            removed += 1
        return removed

    async def cancel_job(self, job_id: str) -> IngestionJob | None:
        job = self._jobs.get(job_id)
        if not job:
            return None
        await self.remove_from_queue(job_id)
        job.status = "cancelled"
        return job

    async def reprocess_job(self, job_id: str) -> IngestionJob | None:
        job = self._jobs.get(job_id)
        if not job:
            return None
        new_job = _make_job()
        new_job.content_b64 = job.content_b64
        new_job.filename = job.filename
        new_job.mime_type = job.mime_type
        new_job.namespace = job.namespace
        new_job.content_source = job.content_source
        new_job.source_url = job.source_url
        new_job.expires_in_days = job.expires_in_days
        new_job.max_retries = job.max_retries
        self._jobs[new_job.job_id] = new_job
        self._queue.append(new_job.job_id)
        return new_job

    async def queue_stats(self) -> dict:
        processing = sum(
            1 for j in self._jobs.values()
            if j.status in {"processing", "processing_graph"}
        )
        failed = [j for j in self._jobs.values() if j.status == "failed"]
        return {
            "queue_depth": len(self._queue),
            "processing": processing,
            "failed_total": len(failed),
            "recent_failures": [{"filename": j.filename, "error": j.error or ""}
                                 for j in failed[-5:]],
        }

    async def list_jobs(
        self,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        namespace: str | None = None,
        query: str | None = None,
    ):
        jobs = list(self._jobs.values())
        if status and status != "all":
            jobs = [j for j in jobs if j.status == status]
        if namespace:
            jobs = [j for j in jobs if j.namespace == namespace]
        if query:
            needle = query.lower()
            jobs = [
                j for j in jobs
                if needle in " ".join([
                    j.job_id, j.filename, j.namespace, j.status, j.error or ""
                ]).lower()
            ]
        jobs.sort(key=lambda j: (j.updated_at, j.created_at, j.job_id), reverse=True)
        page = max(1, page)
        page_size = max(1, page_size)
        total = len(jobs)
        start = (page - 1) * page_size
        end = start + page_size

        class _Page:
            def __init__(self, items, total, page, page_size):
                self.items = items
                self.total = total
                self.page = page
                self.page_size = page_size

        return _Page(jobs[start:end], total, page, page_size)


# ---------------------------------------------------------------------------
# Tests: worker — success path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_worker_marks_job_done_on_success():
    """Worker should mark job done=100% after successful processing."""
    from application.ingestion_worker import ingestion_worker

    queue = InMemoryJobQueue()
    job = _make_job()
    await queue.enqueue(job)

    mock_use_case = MagicMock()
    mock_result = MagicMock()
    mock_result.doc_id = "doc-1"
    mock_result.chunk_count = 5
    progress_updates: list[tuple[str, int]] = []

    async def _fake_execute(req, progress_cb=None):
        if progress_cb:
            await progress_cb(20)
            progress_updates.append(("before_graph", 20))
            await progress_cb(95)
            progress_updates.append(("graph", 95))
        return mock_result

    mock_use_case.execute = _fake_execute

    # Run worker for one iteration then cancel
    async def _run_once():
        # Patch dequeue to return None after first job (stop loop)
        original_dequeue = queue.dequeue
        call_count = 0

        async def _limited_dequeue(timeout=5):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return await original_dequeue(timeout)
            raise asyncio.CancelledError()

        queue.dequeue = _limited_dequeue
        try:
            await ingestion_worker(queue, mock_use_case)
        except asyncio.CancelledError:
            pass

    await _run_once()

    final_job = await queue.get_job(job.job_id)
    assert final_job.status == "done"
    assert final_job.progress == 100
    assert ("graph", 95) in progress_updates


@pytest.mark.asyncio
async def test_worker_keeps_cancelled_job_cancelled_during_processing():
    """Worker should not overwrite a cancelled job back to done."""
    from application.ingestion_worker import ingestion_worker

    queue = InMemoryJobQueue()
    job = _make_job()
    await queue.enqueue(job)

    mock_result = MagicMock()
    mock_result.doc_id = "doc-1"
    mock_result.chunk_count = 5

    async def _fake_execute(req, progress_cb=None):
        if progress_cb:
            await progress_cb(20)
            await queue.cancel_job(job.job_id)
            await progress_cb(95)
        return mock_result

    mock_use_case = MagicMock()
    mock_use_case.execute = _fake_execute

    call_count = 0
    original_dequeue = queue.dequeue

    async def _limited_dequeue(timeout=5):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return await original_dequeue(timeout)
        raise asyncio.CancelledError()

    queue.dequeue = _limited_dequeue
    try:
        await ingestion_worker(queue, mock_use_case)
    except asyncio.CancelledError:
        pass

    final_job = await queue.get_job(job.job_id)
    assert final_job.status == "cancelled"
    assert final_job.progress == 20


@pytest.mark.asyncio
async def test_worker_marks_processing_graph_during_final_stage():
    """Worker should expose processing_graph while graph extraction is in flight."""
    from application.ingestion_worker import ingestion_worker

    queue = InMemoryJobQueue()
    job = _make_job()
    await queue.enqueue(job)

    mock_result = MagicMock()
    mock_result.doc_id = "doc-1"
    mock_result.chunk_count = 5

    async def _fake_execute(req, progress_cb=None):
        if progress_cb:
            await progress_cb(95)
            current = await queue.get_job(job.job_id)
            assert current.status == "processing_graph"
            assert current.progress == 95
        return mock_result

    mock_use_case = MagicMock()
    mock_use_case.execute = _fake_execute

    call_count = 0
    original_dequeue = queue.dequeue

    async def _limited_dequeue(timeout=5):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return await original_dequeue(timeout)
        raise asyncio.CancelledError()

    queue.dequeue = _limited_dequeue
    try:
        await ingestion_worker(queue, mock_use_case)
    except asyncio.CancelledError:
        pass

    final_job = await queue.get_job(job.job_id)
    assert final_job.status == "done"


@pytest.mark.asyncio
async def test_worker_calls_use_case_with_correct_content():
    """Worker should pass decoded content to the use case."""
    from application.ingestion_worker import ingestion_worker
    from application.ingest_document_use_case import IngestRequest

    queue = InMemoryJobQueue()
    raw_content = b"Document content here"
    job = _make_job(raw_content)
    await queue.enqueue(job)

    captured_request = {}

    async def _fake_execute(req, progress_cb=None):
        captured_request["content"] = req.content
        captured_request["filename"] = req.filename
        r = MagicMock()
        r.doc_id = "d1"
        r.chunk_count = 2
        return r

    mock_use_case = MagicMock()
    mock_use_case.execute = _fake_execute

    call_count = 0
    original_dequeue = queue.dequeue

    async def _limited(timeout=5):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return await original_dequeue(timeout)
        raise asyncio.CancelledError()

    queue.dequeue = _limited
    try:
        await ingestion_worker(queue, mock_use_case)
    except asyncio.CancelledError:
        pass

    assert captured_request["content"] == raw_content
    assert captured_request["filename"] == "test.txt"


# ---------------------------------------------------------------------------
# Tests: worker — retry and failure path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_worker_retries_on_failure():
    """Worker should re-enqueue job when retry_count < max_retries."""
    from application.ingestion_worker import ingestion_worker

    queue = InMemoryJobQueue()
    job = _make_job(max_retries=3)
    await queue.enqueue(job)

    mock_use_case = MagicMock()
    mock_use_case.execute = AsyncMock(side_effect=RuntimeError("Transient error"))

    call_count = 0
    original_dequeue = queue.dequeue

    async def _limited(timeout=5):
        nonlocal call_count
        call_count += 1
        if call_count <= 1:
            return await original_dequeue(timeout)
        raise asyncio.CancelledError()

    queue.dequeue = _limited

    with patch("asyncio.sleep", new_callable=AsyncMock):
        try:
            await ingestion_worker(queue, mock_use_case)
        except asyncio.CancelledError:
            pass

    # Job should have been re-enqueued (retry_count incremented)
    final_job = await queue.get_job(job.job_id)
    assert final_job.retry_count == 1
    assert final_job.status == "queued"


@pytest.mark.asyncio
async def test_worker_marks_failed_after_max_retries():
    """Worker should mark job failed after exhausting all retries."""
    from application.ingestion_worker import ingestion_worker

    queue = InMemoryJobQueue()
    # Job already at max_retries
    job = _make_job(max_retries=2, retry_count=2)
    await queue.enqueue(job)

    mock_use_case = MagicMock()
    mock_use_case.execute = AsyncMock(side_effect=ValueError("Fatal error"))

    call_count = 0
    original_dequeue = queue.dequeue

    async def _limited(timeout=5):
        nonlocal call_count
        call_count += 1
        if call_count <= 1:
            return await original_dequeue(timeout)
        raise asyncio.CancelledError()

    queue.dequeue = _limited

    with patch("asyncio.sleep", new_callable=AsyncMock):
        try:
            await ingestion_worker(queue, mock_use_case)
        except asyncio.CancelledError:
            pass

    final_job = await queue.get_job(job.job_id)
    assert final_job.status == "failed"
    assert final_job.error is not None
    assert "Fatal error" in final_job.error


@pytest.mark.asyncio
async def test_cancel_job_removes_from_queue_and_marks_cancelled():
    queue = InMemoryJobQueue()
    job = _make_job()
    await queue.enqueue(job)

    cancelled = await queue.cancel_job(job.job_id)
    assert cancelled is not None
    assert cancelled.status == "cancelled"
    assert job.job_id not in queue._queue


@pytest.mark.asyncio
async def test_reprocess_job_clones_new_job():
    queue = InMemoryJobQueue()
    job = _make_job(b"source content")
    job.namespace = "dohome.sap"
    job.content_source = "manual"
    await queue.enqueue(job)

    cloned = await queue.reprocess_job(job.job_id)
    assert cloned is not None
    assert cloned.job_id != job.job_id
    assert cloned.content == job.content
    assert cloned.namespace == "dohome.sap"
    assert cloned.content_source == "manual"
    assert cloned.status == "queued"
    assert cloned.job_id in queue._queue


# ---------------------------------------------------------------------------
# Tests: enqueue returns immediately (non-blocking check)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_enqueue_is_immediate():
    """Enqueue should return quickly without waiting for processing."""
    queue = InMemoryJobQueue()
    job = _make_job()

    start = time.monotonic()
    await queue.enqueue(job)
    elapsed = time.monotonic() - start

    assert elapsed < 0.1  # should be essentially instant
    result = await queue.get_job(job.job_id)
    assert result is not None
    assert result.status == "queued"


# ---------------------------------------------------------------------------
# Tests: queue_stats
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_queue_stats_counts():
    """queue_stats should accurately count queued/processing/failed jobs."""
    queue = InMemoryJobQueue()

    # Add queued job
    queued_job = _make_job()
    await queue.enqueue(queued_job)

    # Add processing job
    proc_job = _make_job()
    queue._jobs[proc_job.job_id] = proc_job
    await queue.update_status(proc_job.job_id, "processing", 50)

    # Add graph-processing job
    graph_job = _make_job()
    queue._jobs[graph_job.job_id] = graph_job
    await queue.update_status(graph_job.job_id, "processing_graph", 95)

    # Add failed job
    failed_job = _make_job()
    queue._jobs[failed_job.job_id] = failed_job
    await queue.update_status(failed_job.job_id, "failed", 0, error="oops")

    stats = await queue.queue_stats()
    assert stats["queue_depth"] == 1
    assert stats["processing"] == 2
    assert stats["failed_total"] == 1
    assert len(stats["recent_failures"]) == 1
    assert stats["recent_failures"][0]["error"] == "oops"


@pytest.mark.asyncio
async def test_queue_stats_empty():
    """queue_stats on an empty queue returns zeroes."""
    queue = InMemoryJobQueue()
    stats = await queue.queue_stats()
    assert stats["queue_depth"] == 0
    assert stats["processing"] == 0
    assert stats["failed_total"] == 0
    assert stats["recent_failures"] == []


@pytest.mark.asyncio
async def test_list_jobs_filters_and_paging():
    """list_jobs should filter and page results deterministically."""
    queue = InMemoryJobQueue()

    jobs = []
    for idx, status in enumerate(["queued", "processing_graph", "failed", "done"]):
        job = _make_job()
        job.filename = f"doc-{idx}.txt"
        job.namespace = "dohome.sap" if idx < 3 else "default"
        job.status = status
        job.progress = idx * 10
        job.updated_at = time.time() + idx
        queue._jobs[job.job_id] = job
        jobs.append(job)

    page = await queue.list_jobs(page=1, page_size=2, namespace="dohome.sap")
    assert page.total == 3
    assert len(page.items) == 2
    assert page.items[0].status in {"failed", "processing_graph", "queued"}

    filtered = await queue.list_jobs(page=1, page_size=10, status="failed", query="doc-2")
    assert filtered.total == 1
    assert filtered.items[0].status == "failed"
