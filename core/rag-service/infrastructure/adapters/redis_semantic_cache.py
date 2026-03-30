"""
Redis Semantic Cache Middleware
Cache key: cache:{sha256(embedding_hex)}
Cache hit when cosine similarity > threshold (default 0.92)
TTL: 24h
"""
import json
import hashlib
import logging
import math
from typing import Optional, List

from application.ports.i_semantic_cache import ISemanticCache
from domain.entities import QueryResult, Citation, ToolCall

logger = logging.getLogger(__name__)

_DEFAULT_TTL = 86400  # 24h
_CACHE_PREFIX = "cache:"
_DOC_INDEX_PREFIX = "cache_doc:"
_NS_INDEX_PREFIX = "cache_ns:"


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _embedding_key(embedding: List[float], namespace: str) -> str:
    hex_str = "".join(f"{int(v * 1e6):08x}" for v in embedding[:32])  # first 32 dims
    digest = hashlib.sha256(f"{namespace}:{hex_str}".encode()).hexdigest()
    return f"{_CACHE_PREFIX}{digest}"


class RedisSemanticCache(ISemanticCache):
    def __init__(self, redis_url: str = "redis://redis:6379/0",
                 threshold: float = 0.92):
        try:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(redis_url, decode_responses=True)
        except ImportError:
            raise ImportError("redis package required: pip install redis")
        self._threshold = threshold

    async def get(self, query_embedding: List[float],
                  threshold: float = None,
                  namespace: str = "default") -> Optional[QueryResult]:
        threshold = threshold if threshold is not None else self._threshold
        try:
            key = _embedding_key(query_embedding, namespace)
            raw = await self._redis.get(key)
            if raw is None:
                return None
            data = json.loads(raw)
            stored_emb = data.get("embedding", [])
            if not stored_emb:
                # Stored entry has no embedding — cannot verify similarity, skip
                logger.warning("Cache entry missing embedding vector, skipping (key=%s)", key)
                return None
            sim = _cosine_similarity(query_embedding, stored_emb)
            if sim < threshold:
                logger.debug("Cache near-miss: similarity=%.4f < threshold=%.4f (ns=%s)", sim, threshold, namespace)
                return None
            logger.info("Cache hit: similarity=%.4f >= threshold=%.4f (ns=%s)", sim, threshold, namespace)
            return self._deserialize(data["result"])
        except Exception as exc:
            logger.warning("Cache get failed: %s", exc)
            return None

    async def set(self, query_embedding: List[float],
                  result: QueryResult, ttl: int = _DEFAULT_TTL,
                  namespace: str = "default") -> None:
        try:
            key = _embedding_key(query_embedding, namespace)
            payload = json.dumps({
                "embedding": query_embedding,
                "namespace": namespace,
                "result": self._serialize(result),
            })
            await self._redis.setex(key, ttl, payload)
            # Track document → cache key index (for per-document invalidation)
            doc_ids = {c.document_id for c in result.citations}
            for doc_id in doc_ids:
                await self._redis.sadd(f"{_DOC_INDEX_PREFIX}{doc_id}", key)
            # Track namespace → cache key index (for per-namespace invalidation)
            await self._redis.sadd(f"{_NS_INDEX_PREFIX}{namespace}", key)
        except Exception as exc:
            logger.warning("Cache set failed: %s", exc)

    async def invalidate_by_document(self, document_id: str) -> None:
        try:
            index_key = f"{_DOC_INDEX_PREFIX}{document_id}"
            keys = await self._redis.smembers(index_key)
            if keys:
                await self._redis.delete(*keys)
                logger.info("Invalidated %d cache entries for document %s",
                            len(keys), document_id)
            await self._redis.delete(index_key)
        except Exception as exc:
            logger.warning("Cache invalidation failed: %s", exc)

    async def invalidate_by_namespace(self, namespace: str) -> None:
        try:
            index_key = f"{_NS_INDEX_PREFIX}{namespace}"
            keys = await self._redis.smembers(index_key)
            if keys:
                await self._redis.delete(*keys)
                logger.info("Invalidated %d cache entries for namespace %s",
                            len(keys), namespace)
            await self._redis.delete(index_key)
        except Exception as exc:
            logger.warning("Cache namespace invalidation failed: %s", exc)

    def _serialize(self, result: QueryResult) -> dict:
        return {
            "request_id": result.request_id,
            "answer": result.answer,
            "graph_entities": result.graph_entities,
            "citations": [
                {"chunk_id": c.chunk_id, "document_id": c.document_id,
                 "filename": c.filename, "text_snippet": c.text_snippet,
                 "score": c.score, "sequence_index": c.sequence_index}
                for c in result.citations
            ],
            "rewritten_query": result.rewritten_query,
            "hyde_used": result.hyde_used,
            "sub_queries": result.sub_queries,
            "from_cache": True,
            "confidence_score": result.confidence_score,
        }

    def _deserialize(self, data: dict) -> QueryResult:
        citations = [
            Citation(
                chunk_id=c["chunk_id"], document_id=c["document_id"],
                filename=c["filename"], text_snippet=c["text_snippet"],
                score=c["score"], sequence_index=c["sequence_index"],
            )
            for c in data.get("citations", [])
        ]
        return QueryResult(
            request_id=data["request_id"],
            answer=data["answer"],
            citations=citations,
            graph_entities=data.get("graph_entities", []),
            rewritten_query=data.get("rewritten_query"),
            hyde_used=data.get("hyde_used", False),
            sub_queries=data.get("sub_queries", []),
            from_cache=True,
            confidence_score=data.get("confidence_score", 1.0),
        )
