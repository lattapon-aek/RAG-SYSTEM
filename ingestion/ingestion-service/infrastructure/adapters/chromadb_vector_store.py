"""ChromaDB Vector Store adapter for ingestion-service."""
import logging
from typing import List, Optional
from urllib.parse import urlparse

try:
    from application.ports.i_vector_store import IVectorStore
    from domain.entities import ChunkWithEmbedding
except ImportError:
    from ...application.ports.i_vector_store import IVectorStore
    from ...domain.entities import ChunkWithEmbedding

logger = logging.getLogger(__name__)


class ChromaDBVectorStore(IVectorStore):
    def __init__(self, base_url: str = "http://chromadb:8000", collection_prefix: str = "rag_1024"):
        parsed = urlparse(base_url)
        self._host = parsed.hostname or "chromadb"
        self._port = parsed.port or 8000
        self._prefix = collection_prefix
        self._client = None  # lazy init

    def _get_client(self):
        if self._client is None:
            import chromadb
            self._client = chromadb.HttpClient(host=self._host, port=self._port)
        return self._client

    def _get_or_create(self, namespace: str):
        return self._get_client().get_or_create_collection(
            name=f"{self._prefix}_{namespace}",
            metadata={"hnsw:space": "cosine"},
        )

    async def upsert(self, chunks: List[ChunkWithEmbedding], namespace: str = "default") -> None:
        if not chunks:
            return
        col = self._get_or_create(namespace)
        ids = [c.chunk.id for c in chunks]
        embeddings = [c.embedding for c in chunks]
        metadatas = []
        for c in chunks:
            meta = {
                "document_id": str(c.chunk.document_id),
                "text": c.chunk.text,
                "sequence_index": c.chunk.sequence_index,
                "chunk_type": c.chunk.chunk_type or "fixed",
            }
            if c.ingested_at is not None:
                meta["ingested_at"] = c.ingested_at.isoformat()
            if c.expires_at is not None:
                meta["expires_at"] = c.expires_at.isoformat()
            if c.content_source:
                meta["content_source"] = c.content_source
            metadatas.append(meta)
        col.upsert(ids=ids, embeddings=embeddings, metadatas=metadatas)
        logger.info("Upserted %d chunks to ChromaDB namespace=%s", len(chunks), namespace)

    async def delete_by_document_id(self, document_id: str, namespace: str = "default") -> None:
        col = self._get_or_create(namespace)
        results = col.get(where={"document_id": str(document_id)})
        if results["ids"]:
            col.delete(ids=results["ids"])
            logger.info("Deleted %d chunks for document %s", len(results["ids"]), document_id)
