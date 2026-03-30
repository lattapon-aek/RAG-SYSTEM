from abc import ABC, abstractmethod
from typing import List


class IQueryDecomposer(ABC):
    @abstractmethod
    async def decompose(self, query: str) -> List[str]:
        """Decompose a complex query into sub-queries."""
        ...
