"""
DocumentVersionRepository — manages document_versions table.
Provides: create_version, list_versions, get_active_version, set_active, prune_old.
"""
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

import asyncpg

logger = logging.getLogger(__name__)

_MAX_VERSIONS = int(os.getenv("MAX_VERSIONS_PER_DOCUMENT", "3"))


@dataclass
class DocumentVersion:
    id: str
    document_id: str
    version: int
    ingested_at: datetime
    chunk_count: int
    is_active: bool


class DocumentVersionRepository:
    def __init__(self, postgres_url: str):
        self._dsn = postgres_url.replace("postgresql+asyncpg://", "postgresql://")
        self._pool: Optional[asyncpg.Pool] = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self._dsn, min_size=1, max_size=5)
        return self._pool

    async def next_version(self, document_id: str) -> int:
        """Return next version number for a document (1-based)."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT COALESCE(MAX(version), 0) AS max_v FROM document_versions WHERE document_id=$1",
                document_id,
            )
        return (row["max_v"] or 0) + 1

    async def create_version(
        self, document_id: str, version: int, chunk_count: int
    ) -> DocumentVersion:
        """Insert a new version row (inactive by default)."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO document_versions (document_id, version, chunk_count, is_active)
                   VALUES ($1, $2, $3, FALSE)
                   RETURNING id, document_id, version, ingested_at, chunk_count, is_active""",
                document_id, version, chunk_count,
            )
        return self._row_to_ver(row)

    async def set_active(self, document_id: str, version_id: str) -> None:
        """Deactivate all versions for document then activate the given version_id."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "UPDATE document_versions SET is_active=FALSE WHERE document_id=$1",
                    document_id,
                )
                await conn.execute(
                    "UPDATE document_versions SET is_active=TRUE WHERE id=$1",
                    version_id,
                )

    async def list_versions(self, document_id: str) -> List[DocumentVersion]:
        """Return all versions for a document ordered newest first."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT * FROM document_versions
                   WHERE document_id=$1
                   ORDER BY version DESC""",
                document_id,
            )
        return [self._row_to_ver(r) for r in rows]

    async def get_version_by_id(self, version_id: str) -> Optional[DocumentVersion]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM document_versions WHERE id=$1", version_id
            )
        return self._row_to_ver(row) if row else None

    async def prune_old_versions(self, document_id: str, max_versions: int = _MAX_VERSIONS) -> int:
        """Delete oldest inactive versions exceeding max_versions. Returns count deleted."""
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            # Count total versions
            total = await conn.fetchval(
                "SELECT COUNT(*) FROM document_versions WHERE document_id=$1", document_id
            )
            if total <= max_versions:
                return 0
            # Delete oldest inactive versions beyond the limit
            deleted = await conn.execute(
                """DELETE FROM document_versions
                   WHERE id IN (
                       SELECT id FROM document_versions
                       WHERE document_id=$1 AND is_active=FALSE
                       ORDER BY version ASC
                       LIMIT $2
                   )""",
                document_id, total - max_versions,
            )
        count = int(deleted.split()[-1]) if deleted else 0
        if count:
            logger.info("Pruned %d old version(s) for document %s", count, document_id)
        return count

    @staticmethod
    def _row_to_ver(row) -> DocumentVersion:
        return DocumentVersion(
            id=str(row["id"]),
            document_id=str(row["document_id"]),
            version=row["version"],
            ingested_at=row["ingested_at"],
            chunk_count=row["chunk_count"],
            is_active=row["is_active"],
        )
