"""
Graph Service HTTP client with circuit breaker protection
"""
import asyncio
import logging
from typing import List, Dict, Any

import httpx

from application.ports.i_graph_service import IGraphService
from infrastructure.circuit_breaker import get_breaker, CircuitOpenError

logger = logging.getLogger(__name__)
_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0


async def _retry(call, operation: str):
    last_error: Exception = RuntimeError("No attempts made")
    for attempt in range(_MAX_RETRIES):
        try:
            return await call()
        except Exception as exc:
            last_error = exc
            wait = _BACKOFF_BASE ** attempt
            logger.warning(
                "Graph service %s attempt %d failed: %s — retrying in %.1fs",
                operation,
                attempt + 1,
                exc,
                wait,
            )
            await asyncio.sleep(wait)
    raise last_error


class GraphServiceClient(IGraphService):
    def __init__(self, base_url: str = "http://graph-service:8002"):
        self._base_url = base_url.rstrip("/")
        self._breaker = get_breaker("graph")

    async def query_related_entities(self, query: str,
                                     top_k: int = 10,
                                     namespace: str = "default") -> List[Dict[str, Any]]:
        async def _call():
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{self._base_url}/graph/query",
                    json={
                        "query_text": query,
                        "entity_names": [],
                        "max_hops": 2,
                        "namespace": namespace,
                    },
                )
                response.raise_for_status()
                return response.json().get("entities", [])

        try:
            return await self._breaker.call(lambda: _retry(_call, "query_related_entities"))
        except (CircuitOpenError, Exception) as exc:
            logger.warning("Graph service unavailable (%s): %s — skipping graph augmentation",
                           type(exc).__name__, exc)
            # Fallback: vector-only (empty graph result)
            return []

    async def delete_namespace(self, namespace: str) -> dict:
        async def _call():
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.delete(
                    f"{self._base_url}/graph/namespaces/{namespace}"
                )
                response.raise_for_status()
                return response.json()

        try:
            return await self._breaker.call(lambda: _retry(_call, "delete_namespace"))
        except Exception as exc:
            logger.warning("Graph delete_namespace failed: %s", exc)
            return {"deleted_entities": 0}

    async def delete_document(self, document_id: str,
                              namespace: str = "default") -> dict:
        async def _call():
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.delete(
                    f"{self._base_url}/graph/documents/{document_id}",
                    params={"namespace": namespace},
                )
                response.raise_for_status()
                return {"deleted_document": document_id, "namespace": namespace}

        try:
            return await self._breaker.call(lambda: _retry(_call, "delete_document"))
        except Exception as exc:
            logger.warning("Graph delete_document failed: %s", exc)
            return {"deleted_document": None, "namespace": namespace}
