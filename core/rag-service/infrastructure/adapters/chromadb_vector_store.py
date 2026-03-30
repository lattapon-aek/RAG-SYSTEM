"""
ChromaDB Vector Store adapter
"""
import logging
from typing import List, Optional, Dict, Any

from application.ports.i_vector_store import IVectorStore
from domain.entities import RerankedResult

logger = logging.getLogger(__name__)


class ChromaDBVectorStore(IVectorStore):
    def __init__(self, host: str = "chromadb", port: int = 8000,
                 collection_prefix: str = "rag_1024"):
        self._host = host
        self._port = port
        self._prefix = collection_prefix
        self._client = None  # lazy init

    def _get_client(self):
        if self._client is None:
            import chromadb
            self._client = chromadb.HttpClient(host=self._host, port=self._port)
        return self._client

    def _collection_name(self, namespace: str) -> str:
        return f"{self._prefix}_{namespace}"

    def _get_or_create(self, namespace: str):
        return self._get_client().get_or_create_collection(
            name=self._collection_name(namespace),
            metadata={"hnsw:space": "cosine"},
        )

    async def upsert(self, chunk_id: str, embedding: List[float], text: str,
                     document_id: str, namespace: str = "default",
                     metadata: Optional[Dict[str, Any]] = None) -> None:
        col = self._get_or_create(namespace)
        meta = {"document_id": document_id, "text": text, **(metadata or {})}
        col.upsert(ids=[chunk_id], embeddings=[embedding], metadatas=[meta])

    async def search(self, embedding: List[float], top_k: int = 10,
                     namespace: str = "default",
                     filters: Optional[Dict[str, Any]] = None) -> List[RerankedResult]:
        col = self._get_or_create(namespace)
        where = filters or None
        results = col.query(
            query_embeddings=[embedding],
            n_results=top_k,
            where=where,
            include=["metadatas", "distances"],
        )
        output: List[RerankedResult] = []
        ids = results["ids"][0]
        metadatas = results["metadatas"][0]
        distances = results["distances"][0]
        for rank, (cid, meta, dist) in enumerate(zip(ids, metadatas, distances)):
            score = 1.0 - dist  # cosine distance → similarity
            output.append(RerankedResult(
                chunk_id=cid,
                document_id=meta.get("document_id", ""),
                text=meta.get("text", ""),
                score=score,
                original_rank=rank,
                reranked_rank=rank,
                namespace=namespace,
                metadata=meta,
            ))
        return output

    async def delete_by_document_id(self, document_id: str,
                                    namespace: str = "default") -> None:
        col = self._get_or_create(namespace)
        results = col.get(where={"document_id": document_id})
        if results["ids"]:
            col.delete(ids=results["ids"])
            logger.info("Deleted %d chunks for document %s",
                        len(results["ids"]), document_id)
