"""PostgreSQL-backed document repository using asyncpg."""
import logging
from typing import Optional, List
from datetime import datetime

import asyncpg

from application.ports.i_document_repository import IDocumentRepository
from domain.entities import Document

logger = logging.getLogger(__name__)


class PostgresDocumentRepository(IDocumentRepository):
    def __init__(self, postgres_url: str):
        # asyncpg uses postgresql:// scheme
        self._dsn = postgres_url.replace("postgresql+asyncpg://", "postgresql://")
        self._pool: Optional[asyncpg.Pool] = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self._dsn, min_size=1, max_size=5)
        return self._pool

    async def save(self, document: Document) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO documents (id, filename, mime_type, content_source, source_url,
                    source_hash, ingested_at, expires_at, freshness_score, chunk_count, namespace)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (id) DO UPDATE SET
                    filename=EXCLUDED.filename, mime_type=EXCLUDED.mime_type,
                    content_source=EXCLUDED.content_source, source_url=EXCLUDED.source_url,
                    source_hash=EXCLUDED.source_hash, ingested_at=EXCLUDED.ingested_at,
                    expires_at=EXCLUDED.expires_at, freshness_score=EXCLUDED.freshness_score,
                    chunk_count=EXCLUDED.chunk_count, namespace=EXCLUDED.namespace
                """,
                document.id, document.filename, document.mime_type, document.content_source,
                document.source_url, document.source_hash, document.ingested_at,
                document.expires_at, document.freshness_score, document.chunk_count,
                document.namespace,
            )

    async def find_by_id(self, document_id: str,
                         namespace: Optional[str] = None) -> Optional[Document]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            if namespace is None:
                row = await conn.fetchrow("SELECT * FROM documents WHERE id=$1", document_id)
            else:
                row = await conn.fetchrow(
                    "SELECT * FROM documents WHERE id=$1 AND namespace=$2",
                    document_id, namespace,
                )
        return self._row_to_doc(row) if row else None

    async def find_by_source_hash(self, source_hash: str,
                                  namespace: Optional[str] = None) -> Optional[Document]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            if namespace is None:
                row = await conn.fetchrow("SELECT * FROM documents WHERE source_hash=$1", source_hash)
            else:
                row = await conn.fetchrow(
                    "SELECT * FROM documents WHERE source_hash=$1 AND namespace=$2",
                    source_hash, namespace,
                )
        return self._row_to_doc(row) if row else None

    async def delete(self, document_id: str, namespace: Optional[str] = None) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "DELETE FROM document_versions WHERE document_id=$1",
                    document_id,
                )
                if namespace is None:
                    await conn.execute("DELETE FROM documents WHERE id=$1", document_id)
                else:
                    await conn.execute(
                        "DELETE FROM documents WHERE id=$1 AND namespace=$2",
                        document_id, namespace,
                    )

    async def list_all(self, namespace: str = "default") -> List[Document]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM documents WHERE namespace=$1", namespace)
        return [self._row_to_doc(r) for r in rows]

    async def update_chunk_count(self, document_id: str, chunk_count: int) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE documents SET chunk_count=$1 WHERE id=$2", chunk_count, document_id
            )

    @staticmethod
    def _row_to_doc(row) -> Document:
        return Document(
            id=row["id"],
            filename=row["filename"],
            mime_type=row["mime_type"],
            content_source=row.get("content_source", "upload"),
            source_url=row.get("source_url"),
            source_hash=row.get("source_hash"),
            ingested_at=row.get("ingested_at"),
            expires_at=row.get("expires_at"),
            freshness_score=row.get("freshness_score", 1.0),
            chunk_count=row.get("chunk_count", 0),
            namespace=row.get("namespace", "default"),
        )
