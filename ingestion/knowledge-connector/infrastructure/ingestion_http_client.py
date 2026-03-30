"""
IngestionServiceHttpClient — HTTP client for the Ingestion Service.
"""
import logging
from typing import Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from application.ports.i_ingestion_service_client import IIngestionServiceClient
from domain.errors import IngestionServiceError

logger = logging.getLogger(__name__)


class IngestionServiceHttpClient(IIngestionServiceClient):
    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def ingest_text(
        self,
        text: str,
        filename: str,
        namespace: str = "default",
        source_url: Optional[str] = None,
        content_source: str = "web",
        expires_in_days: Optional[int] = None,
    ) -> dict:
        payload = {
            "text": text,
            "filename": filename,
            "namespace": namespace,
            "content_source": content_source,
        }
        if source_url:
            payload["source_url"] = source_url
        if expires_in_days is not None:
            payload["expires_in_days"] = expires_in_days

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(f"{self._base_url}/ingest/text", json=payload)
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as exc:
            raise IngestionServiceError(f"Ingestion service call failed: {exc}") from exc
