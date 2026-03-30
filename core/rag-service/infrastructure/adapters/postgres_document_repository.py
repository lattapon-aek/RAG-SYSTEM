"""
PostgreSQL Document Repository
"""
import json
import logging
from typing import Optional, List
from datetime import datetime

from application.ports.i_document_repository import IDocumentRepository
from domain.entities import Document

logger = logging.getLogger(__name__)


class PostgresDocumentRepository(IDocumentRepository):
    def __init__(self, dsn: str):
        self._dsn = dsn
        self._pool = None

    async def _get_pool(self):
        if self._pool is None:
            try:
                import asyncpg
                self._pool = await asyncpg.create_pool(self._dsn)
            except Exception as exc:
                logger.error("Failed to connect to PostgreSQL: %s", exc)
                raise
        return self._pool

    async def save(self, document: Document) -> None:
        pool = await self._get_pool()
        await pool.execute(
            """INSERT INTO documents (id, filename, mime_type, source_hash,
               namespace, ingested_at, expires_at, chunk_count)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (id) DO UPDATE SET
               chunk_count=EXCLUDED.chunk_count,
               expires_at=EXCLUDED.expires_at""",
            document.id, document.filename,
            getattr(document, "content_type", "") or "",
            document.source_hash, document.namespace,
            document.ingested_at or datetime.utcnow(),
            document.expires_at,
            document.chunk_count,
        )

    async def find_by_id(self, document_id: str,
                         namespace: Optional[str] = None) -> Optional[Document]:
        pool = await self._get_pool()
        if namespace is None:
            row = await pool.fetchrow(
                "SELECT * FROM documents WHERE id = $1", document_id
            )
        else:
            row = await pool.fetchrow(
                "SELECT * FROM documents WHERE id = $1 AND namespace = $2",
                document_id, namespace,
            )
        return self._row_to_doc(row) if row else None

    async def find_by_source_hash(self, source_hash: str,
                                  namespace: Optional[str] = None) -> Optional[Document]:
        pool = await self._get_pool()
        if namespace is None:
            row = await pool.fetchrow(
                "SELECT * FROM documents WHERE source_hash = $1", source_hash
            )
        else:
            row = await pool.fetchrow(
                "SELECT * FROM documents WHERE source_hash = $1 AND namespace = $2",
                source_hash, namespace,
            )
        return self._row_to_doc(row) if row else None

    async def delete(self, document_id: str, namespace: Optional[str] = None) -> None:
        pool = await self._get_pool()
        if namespace is None:
            await pool.execute(
                "DELETE FROM document_versions WHERE document_id = $1",
                document_id,
            )
            await pool.execute("DELETE FROM documents WHERE id = $1", document_id)
        else:
            await pool.execute(
                """DELETE FROM document_versions
                   WHERE document_id = $1
                     AND document_id IN (
                         SELECT id FROM documents WHERE id = $1 AND namespace = $2
                     )""",
                document_id, namespace,
            )
            await pool.execute(
                "DELETE FROM documents WHERE id = $1 AND namespace = $2",
                document_id, namespace,
            )

    async def list_all(self, namespace: str = "default") -> List[Document]:
        pool = await self._get_pool()
        rows = await pool.fetch(
            "SELECT * FROM documents WHERE namespace = $1 ORDER BY ingested_at DESC",
            namespace,
        )
        return [self._row_to_doc(r) for r in rows]

    async def update_chunk_count(self, document_id: str, chunk_count: int) -> None:
        pool = await self._get_pool()
        await pool.execute(
            "UPDATE documents SET chunk_count = $1 WHERE id = $2",
            chunk_count, document_id,
        )

    def _row_to_doc(self, row) -> Document:
        return Document(
            id=str(row["id"]),
            filename=row["filename"],
            content_type=row.get("content_type") or row.get("mime_type", ""),
            source_hash=row.get("source_hash", ""),
            namespace=row.get("namespace", "default"),
            ingested_at=row["ingested_at"],
            expires_at=row.get("expires_at"),
            chunk_count=row["chunk_count"] or 0,
            metadata=json.loads(row["metadata"]) if row.get("metadata") else {},
        )
