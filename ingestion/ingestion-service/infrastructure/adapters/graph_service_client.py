"""HTTP client for the Graph Service entity extraction endpoint."""
import asyncio
import logging
from typing import Optional, Dict, Any

import httpx

from application.ports.i_graph_service_client import IGraphServiceClient

logger = logging.getLogger(__name__)
_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0


class GraphServiceHttpClient(IGraphServiceClient):
    def __init__(self, base_url: str, timeout: float = 180.0):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    async def extract_entities(self, text: str, document_id: str,
                               namespace: str = "default",
                               dry_run: bool = False) -> Optional[Dict[str, Any]]:
        """POST to graph-service /extract endpoint.

        Returns response data when dry_run=True so callers can preview the
        extracted graph without persisting it.
        """
        url = f"{self._base_url}/graph/extract"
        payload = {"text": text, "document_id": document_id, "namespace": namespace, "dry_run": dry_run}
        last_error: Exception = RuntimeError("No attempts made")
        for attempt in range(_MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(url, json=payload)
                    resp.raise_for_status()
                    logger.debug("Graph extraction triggered for doc %s", document_id)
                    if dry_run:
                        return resp.json()
                    return None
            except Exception as exc:
                last_error = exc
                wait = _BACKOFF_BASE ** attempt
                logger.warning(
                    "Graph service call attempt %d failed for doc %s: %s — retrying in %.1fs",
                    attempt + 1,
                    document_id,
                    exc,
                    wait,
                )
                await asyncio.sleep(wait)
        # Non-fatal — graph enrichment is best-effort
        logger.warning("Graph service unavailable after retries for doc %s: %s", document_id, last_error)
        return None
