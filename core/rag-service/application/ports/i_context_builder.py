from abc import ABC, abstractmethod
from typing import List
try:
    from domain.entities import RerankedResult, BuiltContext
except ImportError:
    from domain.entities import RerankedResult, BuiltContext  # type: ignore


class IContextBuilder(ABC):
    @abstractmethod
    async def build(self, query: str, chunks: List[RerankedResult],
                    max_tokens: int = 4096) -> BuiltContext:
        """Assemble context from reranked chunks with lost-in-the-middle ordering."""
        ...
