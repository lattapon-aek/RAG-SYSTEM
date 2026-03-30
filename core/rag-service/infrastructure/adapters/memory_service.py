"""
Memory Layer adapters
- Short-term: Redis db1, TTL 1h
- Long-term: PostgreSQL user_memory table
- Composite: both simultaneously (default when MEMORY_BACKEND=composite)
"""
import json
import logging
import uuid
from datetime import datetime
from typing import List, Optional, Dict, Any

from application.ports.i_memory_service import IMemoryService

logger = logging.getLogger(__name__)

_SHORT_TERM_TTL = 3600  # 1h
_SHORT_TERM_PREFIX = "mem:"


class RedisMemoryAdapter(IMemoryService):
    """Short-term memory backed by Redis db1."""

    def __init__(self, redis_url: str = "redis://redis:6379/1"):
        try:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(redis_url, decode_responses=True)
        except ImportError:
            raise ImportError("redis package required: pip install redis")

    def _user_key(self, user_id: str) -> str:
        return f"{_SHORT_TERM_PREFIX}{user_id}"

    async def get(self, user_id: str, query: str) -> List[Dict[str, Any]]:
        try:
            raw = await self._redis.get(self._user_key(user_id))
            if not raw:
                return []
            entries: List[Dict[str, Any]] = json.loads(raw)
            # Simple relevance: return all entries (short-term is small)
            return entries
        except Exception as exc:
            logger.warning("Memory get failed: %s", exc)
            return []

    async def save(self, user_id: str, content: str,
                   metadata: Optional[Dict[str, Any]] = None) -> str:
        try:
            raw = await self._redis.get(self._user_key(user_id))
            entries: List[Dict[str, Any]] = json.loads(raw) if raw else []
            memory_id = str(uuid.uuid4())
            entries.append({
                "id": memory_id,
                "content": content,
                "created_at": datetime.utcnow().isoformat(),
                "metadata": metadata or {},
            })
            await self._redis.setex(
                self._user_key(user_id), _SHORT_TERM_TTL, json.dumps(entries)
            )
            return memory_id
        except Exception as exc:
            logger.warning("Memory save failed: %s", exc)
            return ""

    async def list(self, user_id: str) -> List[Dict[str, Any]]:
        return await self.get(user_id, "")

    async def delete(self, user_id: str, memory_id: str) -> None:
        try:
            raw = await self._redis.get(self._user_key(user_id))
            if not raw:
                return
            entries = [e for e in json.loads(raw) if e["id"] != memory_id]
            await self._redis.setex(
                self._user_key(user_id), _SHORT_TERM_TTL, json.dumps(entries)
            )
        except Exception as exc:
            logger.warning("Memory delete failed: %s", exc)


class PostgresMemoryAdapter(IMemoryService):
    """Long-term memory backed by PostgreSQL user_memory table."""

    def __init__(self, dsn: str):
        try:
            import asyncpg
            self._dsn = dsn
            self._asyncpg = asyncpg
        except ImportError:
            raise ImportError("asyncpg package required: pip install asyncpg")
        self._pool = None

    async def _get_pool(self):
        if self._pool is None:
            self._pool = await self._asyncpg.create_pool(self._dsn)
        return self._pool

    async def get(self, user_id: str, query: str) -> List[Dict[str, Any]]:
        pool = await self._get_pool()
        rows = await pool.fetch(
            "SELECT id, content, memory_type, created_at FROM user_memory "
            "WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
            user_id,
        )
        return [
            {
                "id": str(r["id"]),
                "content": r["content"],
                "metadata": {"memory_type": r["memory_type"]},
                "created_at": str(r["created_at"]),
            }
            for r in rows
        ]

    async def save(self, user_id: str, content: str,
                   metadata: Optional[Dict[str, Any]] = None) -> str:
        pool = await self._get_pool()
        memory_id = str(uuid.uuid4())
        memory_type = (metadata or {}).get("memory_type", "general")
        await pool.execute(
            "INSERT INTO user_memory (id, user_id, content, memory_type) "
            "VALUES ($1, $2, $3, $4)",
            memory_id, user_id, content, memory_type,
        )
        return memory_id

    async def list(self, user_id: str) -> List[Dict[str, Any]]:
        return await self.get(user_id, "")

    async def delete(self, user_id: str, memory_id: str) -> None:
        pool = await self._get_pool()
        await pool.execute(
            "DELETE FROM user_memory WHERE id = $1 AND user_id = $2",
            memory_id, user_id,
        )


class CompositeMemoryAdapter(IMemoryService):
    """Combines Redis (short-term, TTL 1h) + PostgreSQL (long-term, permanent).

    - save()  → writes to BOTH backends
    - get()   → merges results from both, deduped by id, with 'source' field
    - list()  → same as get() with no query filter
    - delete()→ removes from both backends
    - list_short() / list_long() → for UI tab display
    """

    def __init__(self, short: RedisMemoryAdapter, long: PostgresMemoryAdapter):
        self._short = short
        self._long = long

    async def save(self, user_id: str, content: str,
                   metadata: Optional[Dict[str, Any]] = None) -> str:
        meta = metadata or {}
        target = meta.pop("_save_target", "composite")  # composite | redis | postgres

        memory_id = str(uuid.uuid4())

        if target in ("composite", "postgres"):
            pg_id = await self._long.save(user_id, content, meta)
            memory_id = pg_id  # use Postgres id as canonical

        if target in ("composite", "redis"):
            try:
                raw = await self._short._redis.get(self._short._user_key(user_id))
                entries: List[Dict[str, Any]] = json.loads(raw) if raw else []
                entries.append({
                    "id": memory_id,
                    "content": content,
                    "created_at": datetime.utcnow().isoformat(),
                    "metadata": meta,
                    "source": "short",
                })
                await self._short._redis.setex(
                    self._short._user_key(user_id), _SHORT_TERM_TTL, json.dumps(entries)
                )
            except Exception as exc:
                logger.warning("Composite: Redis write failed: %s", exc)

        return memory_id

    async def get(self, user_id: str, query: str) -> List[Dict[str, Any]]:
        short_entries = await self.list_short(user_id)
        long_entries = await self.list_long(user_id)
        # Merge: long-term is canonical, short-term adds session context
        seen_ids: set = {e["id"] for e in long_entries}
        merged = list(long_entries)
        for e in short_entries:
            if e["id"] not in seen_ids:
                merged.append(e)
                seen_ids.add(e["id"])
        return merged

    async def list(self, user_id: str) -> List[Dict[str, Any]]:
        return await self.get(user_id, "")

    async def delete(self, user_id: str, memory_id: str) -> None:
        await self._long.delete(user_id, memory_id)
        try:
            raw = await self._short._redis.get(self._short._user_key(user_id))
            if raw:
                entries = [e for e in json.loads(raw) if e["id"] != memory_id]
                await self._short._redis.setex(
                    self._short._user_key(user_id), _SHORT_TERM_TTL, json.dumps(entries)
                )
        except Exception as exc:
            logger.warning("Composite: Redis delete failed: %s", exc)

    async def list_short(self, user_id: str) -> List[Dict[str, Any]]:
        entries = await self._short.list(user_id)
        for e in entries:
            e["source"] = "short"
        return entries

    async def list_long(self, user_id: str) -> List[Dict[str, Any]]:
        entries = await self._long.list(user_id)
        for e in entries:
            e["source"] = "long"
        return entries
