"""
Graph Service HTTP client with circuit breaker protection
"""
import asyncio
import logging
import re
from typing import List, Dict, Any, Optional

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

    @staticmethod
    def _extract_seed_names(query: str) -> List[str]:
        cleaned = query.strip()
        if not cleaned:
            return []

        seeds: List[str] = []

        team_match = re.search(
            r"(?:\bทีม\b|\bteam\b)\s+([A-Za-z0-9ก-๙_.\-/ ]{2,80})",
            cleaned,
            flags=re.IGNORECASE,
        )
        if team_match:
            team_tail = team_match.group(1).strip()
            team_name = re.sub(
                r"\s+(?:มี|ได้แก่|คือ|เป็น|รับผิดชอบ|ดูแล|ทำหน้าที่|ของ|ที่|ซึ่ง|และ|โดย)\b.*$",
                "",
                team_tail,
                flags=re.IGNORECASE,
            ).strip(" ,.;:，。")
            if team_name:
                seeds.append(team_name)

        for token in re.findall(r"\b[A-Z]{2,}\b", cleaned):
            if token not in seeds:
                seeds.append(token)

        return list(dict.fromkeys(seeds))

    async def query_related_entities(
        self,
        query: str,
        top_k: int = 10,
        namespace: str = "default",
        entity_names: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        async def _call():
            seeds = entity_names if entity_names is not None else self._extract_seed_names(query)
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{self._base_url}/graph/query",
                    json={
                        "query_text": query,
                        "entity_names": seeds,
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
