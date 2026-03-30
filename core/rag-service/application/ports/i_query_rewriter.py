from abc import ABC, abstractmethod


class IQueryRewriter(ABC):
    @abstractmethod
    async def rewrite(self, query: str) -> str:
        """Rewrite query for better retrieval."""
        ...
