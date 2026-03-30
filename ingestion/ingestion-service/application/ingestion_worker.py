"""
Ingestion worker — pulls jobs from the Redis queue and processes them.
Runs as a background asyncio task started during app startup.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def ingestion_worker(queue, use_case) -> None:
    """Continuously dequeue and process ingestion jobs with retry."""
    from infrastructure.adapters.job_queue import IngestionJob
    from application.ingest_document_use_case import IngestRequest

    logger.info("Ingestion worker started")
    while True:
        try:
            job: IngestionJob | None = await queue.dequeue(timeout=5)
            if job is None:
                continue

            logger.info("Worker picked up job %s (%s)", job.job_id, job.filename)
            current = await queue.get_job(job.job_id)
            if current and current.status == "cancelled":
                logger.info("Job %s was cancelled before processing started", job.job_id)
                continue
            await queue.update_status(job.job_id, "processing", 5)

            async def _progress(pct: int) -> None:
                current_job = await queue.get_job(job.job_id)
                if current_job and current_job.status == "cancelled":
                    return
                status = "processing_graph" if pct >= 95 else "processing"
                await queue.update_status(job.job_id, status, pct)

            try:
                result = await use_case.execute(
                    IngestRequest(
                        content=job.content,
                        filename=job.filename,
                        mime_type=job.mime_type,
                        namespace=job.namespace,
                        content_source=job.content_source,
                        source_url=job.source_url,
                        expires_in_days=job.expires_in_days,
                    ),
                    progress_cb=_progress,
                )
                current = await queue.get_job(job.job_id)
                if current and current.status == "cancelled":
                    logger.info("Job %s cancelled during processing", job.job_id)
                    continue
                await queue.update_status(job.job_id, "done", 100)
                logger.info(
                    "Job %s done: doc_id=%s chunks=%d",
                    job.job_id, result.doc_id, result.chunk_count,
                )

            except Exception as exc:
                if job.retry_count < job.max_retries:
                    wait = 2 ** job.retry_count
                    logger.warning(
                        "Job %s failed (attempt %d/%d), retry in %ds: %s",
                        job.job_id, job.retry_count + 1, job.max_retries, wait, exc,
                    )
                    job.retry_count += 1
                    await asyncio.sleep(wait)
                    await queue.re_enqueue(job)
                else:
                    logger.error("Job %s permanently failed: %s", job.job_id, exc)
                    await queue.update_status(job.job_id, "failed", 0, error=str(exc))

        except asyncio.CancelledError:
            logger.info("Ingestion worker shutting down")
            break
        except Exception as exc:
            logger.error("Worker loop unexpected error: %s", exc)
            await asyncio.sleep(1)
