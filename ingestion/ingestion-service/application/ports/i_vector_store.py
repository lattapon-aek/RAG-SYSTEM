from abc import ABC, abstractmethod
from typing import List
try:
    from ...domain.entities import ChunkWithEmbedding
except ImportError:
    from domain.entities import ChunkWithEmbedding  # type: ignore


class IVectorStore(ABC):
    @abstractmethod
    async def upsert(self, chunks: List[ChunkWithEmbedding], namespace: str = "default") -> None:
        ...

    @abstractmethod
    async def delete_by_document_id(self, document_id: str, namespace: str = "default") -> None:
        ...
