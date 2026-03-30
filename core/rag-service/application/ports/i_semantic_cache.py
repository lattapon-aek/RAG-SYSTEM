from abc import ABC, abstractmethod
from typing import Optional, List
from domain.entities import QueryResult


class ISemanticCache(ABC):
    @abstractmethod
    async def get(self, query_embedding: List[float],
                  threshold: float = 0.92,
                  namespace: str = "default") -> Optional[QueryResult]:
        """Return cached result if cosine similarity > threshold."""
        ...

    @abstractmethod
    async def set(self, query_embedding: List[float],
                  result: QueryResult, ttl: int = 86400,
                  namespace: str = "default") -> None:
        """Cache a query result with TTL (seconds)."""
        ...

    @abstractmethod
    async def invalidate_by_document(self, document_id: str) -> None:
        """Invalidate cache entries related to a document."""
        ...

    @abstractmethod
    async def invalidate_by_namespace(self, namespace: str) -> None:
        """Invalidate all cache entries for a namespace."""
        ...
