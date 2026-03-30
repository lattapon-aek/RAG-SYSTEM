"""
Reranker Service HTTP client + RRF merge algorithm
"""
import asyncio
import logging
from typing import List, Dict

import httpx

try:
    from application.ports.i_reranker import IReranker
    from domain.entities import RerankedResult
    from infrastructure.circuit_breaker import get_breaker, CircuitOpenError
except ImportError:
    from application.ports.i_reranker import IReranker  # type: ignore
    from domain.entities import RerankedResult  # type: ignore
    from infrastructure.circuit_breaker import get_breaker, CircuitOpenError  # type: ignore

logger = logging.getLogger(__name__)

_RRF_K = 60  # RRF constant
_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0


def rrf_merge(result_lists: List[List[RerankedResult]],
              top_n: int = 10) -> List[RerankedResult]:
    """Reciprocal Rank Fusion merge of multiple ranked lists."""
    scores: Dict[str, float] = {}
    items: Dict[str, RerankedResult] = {}

    for ranked_list in result_lists:
        for rank, item in enumerate(ranked_list):
            key = item.chunk_id
            scores[key] = scores.get(key, 0.0) + 1.0 / (_RRF_K + rank + 1)
            if key not in items:
                items[key] = item

    merged = sorted(items.values(), key=lambda x: scores[x.chunk_id], reverse=True)
    for new_rank, item in enumerate(merged[:top_n]):
        item.reranked_rank = new_rank
        item.score = scores[item.chunk_id]
    return merged[:top_n]


class RerankerServiceClient(IReranker):
    """HTTP client for the reranker-service with circuit breaker protection."""

    def __init__(self, base_url: str = "http://reranker-service:8005"):
        self._base_url = base_url.rstrip("/")
        self._breaker = get_breaker("reranker")

    async def rerank(self, query: str, candidates: List[RerankedResult],
                     top_n: int = 5) -> List[RerankedResult]:
        if not candidates:
            return []

        async def _call():
            last_error: Exception = RuntimeError("No attempts made")
            for attempt in range(_MAX_RETRIES):
                try:
                    payload = {
                        "query": query,
                        "candidates": [
                            {
                                "id": c.chunk_id,
                                "text": c.text,
                                "score": c.score,
                                "metadata": {
                                    "document_id": c.document_id,
                                    **(c.metadata or {}),
                                },
                            }
                            for c in candidates
                        ],
                        "top_n": top_n,
                    }
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        response = await client.post(
                            f"{self._base_url}/rerank", json=payload
                        )
                        response.raise_for_status()
                        data = response.json()

                    reranked: List[RerankedResult] = []
                    for new_rank, item in enumerate(data.get("results", [])):
                        original = next(
                            (c for c in candidates if c.chunk_id == item["id"]),
                            None,
                        )
                        if original:
                            original.reranked_rank = new_rank
                            original.score = item.get("score", original.score)
                            reranked.append(original)
                    return reranked
                except Exception as exc:
                    last_error = exc
                    wait = _BACKOFF_BASE ** attempt
                    logger.warning(
                        "Reranker attempt %d failed: %s — retrying in %.1fs",
                        attempt + 1,
                        exc,
                        wait,
                    )
                    await asyncio.sleep(wait)
            raise last_error

        try:
            return await self._breaker.call(_call)
        except (CircuitOpenError, Exception) as exc:
            logger.warning("Reranker unavailable (%s): %s — returning Stage 1 results",
                           type(exc).__name__, exc)
            # Fallback: return Stage 1 RRF results sorted by score
            return sorted(candidates, key=lambda x: x.score, reverse=True)[:top_n]


class NoOpReranker(IReranker):
    """Pass-through reranker — returns input order."""

    async def rerank(self, query: str, candidates: List[RerankedResult],
                     top_n: int = 5) -> List[RerankedResult]:
        return candidates[:top_n]
