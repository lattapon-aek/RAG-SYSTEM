from abc import ABC, abstractmethod
from domain.entities import StructuredQueryResult


class IStructuredQueryEngine(ABC):
    @abstractmethod
    async def execute(self, query: str, connection_string: str) -> StructuredQueryResult:
        """Execute a structured query and return results."""
