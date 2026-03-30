from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from domain.entities import RerankedResult


class IVectorStore(ABC):
    @abstractmethod
    async def upsert(self, chunk_id: str, embedding: List[float], text: str,
                     document_id: str, namespace: str = "default",
                     metadata: Optional[Dict[str, Any]] = None) -> None:
        ...

    @abstractmethod
    async def search(self, embedding: List[float], top_k: int = 10,
                     namespace: str = "default",
                     filters: Optional[Dict[str, Any]] = None) -> List[RerankedResult]:
        ...

    @abstractmethod
    async def delete_by_document_id(self, document_id: str,
                                    namespace: str = "default") -> None:
        ...
