from abc import ABC, abstractmethod
from typing import List

try:
    from ...domain.entities import Chunk
except ImportError:
    from domain.entities import Chunk  # type: ignore


class IChunker(ABC):
    @abstractmethod
    async def chunk(self, text: str, document_id: str, namespace: str = "default") -> List[Chunk]:
        """Split text into chunks."""
        ...
