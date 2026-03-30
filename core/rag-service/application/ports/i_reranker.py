from abc import ABC, abstractmethod
from typing import List
try:
    from domain.entities import RerankedResult
except ImportError:
    from domain.entities import RerankedResult  # type: ignore


class IReranker(ABC):
    @abstractmethod
    async def rerank(self, query: str, candidates: List[RerankedResult],
                     top_n: int = 5) -> List[RerankedResult]:
        """Rerank candidates by relevance to query."""
        ...
