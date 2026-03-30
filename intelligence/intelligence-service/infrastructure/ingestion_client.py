"""HTTP client for Ingestion Service"""
import asyncio
import logging
import httpx
from application.ports.i_ingestion_client import IIngestionServiceClient
from domain.errors import IngestionClientError

logger = logging.getLogger(__name__)
_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0


class IngestionServiceHttpClient(IIngestionServiceClient):
    def __init__(self, base_url: str = "http://ingestion-service:8001"):
        self._base_url = base_url.rstrip("/")

    async def ingest_text(self, content: str, metadata: dict) -> str:
        last_error: Exception = RuntimeError("No attempts made")
        for attempt in range(_MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    content_source = metadata.get("content_source", "self_learning")
                    payload = {
                        "text": content,
                        "filename": metadata.get(
                            "filename",
                            f"self_learning_{metadata.get('candidate_id', 'unknown')}.txt",
                        ),
                        "namespace": metadata.get("namespace", "default"),
                        "content_source": content_source,
                    }
                    if metadata.get("source_url"):
                        payload["source_url"] = metadata["source_url"]
                    if metadata.get("mime_type"):
                        payload["mime_type"] = metadata["mime_type"]
                    resp = await client.post(
                        f"{self._base_url}/ingest/text",
                        json=payload,
                    )
                    resp.raise_for_status()
                    return resp.json().get("document_id", "")
            except Exception as exc:
                last_error = exc
                wait = _BACKOFF_BASE ** attempt
                logger.warning(
                    "Ingestion Service call attempt %d failed: %s — retrying in %.1fs",
                    attempt + 1,
                    exc,
                    wait,
                )
                await asyncio.sleep(wait)
        logger.error("Ingestion Service call failed after retries: %s", last_error)
        raise IngestionClientError(str(last_error)) from last_error
