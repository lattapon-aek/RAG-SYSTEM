from abc import ABC, abstractmethod
from typing import Optional, List
from domain.entities import Document


class IDocumentRepository(ABC):
    @abstractmethod
    async def save(self, document: Document) -> None: ...

    @abstractmethod
    async def find_by_id(self, document_id: str,
                         namespace: Optional[str] = None) -> Optional[Document]: ...

    @abstractmethod
    async def find_by_source_hash(self, source_hash: str,
                                  namespace: Optional[str] = None) -> Optional[Document]: ...

    @abstractmethod
    async def delete(self, document_id: str, namespace: Optional[str] = None) -> None: ...

    @abstractmethod
    async def list_all(self, namespace: str = "default") -> List[Document]: ...

    @abstractmethod
    async def update_chunk_count(self, document_id: str, chunk_count: int) -> None: ...
