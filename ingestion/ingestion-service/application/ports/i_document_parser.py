from abc import ABC, abstractmethod
from typing import Tuple
try:
    from ...domain.entities import Document
except ImportError:
    from domain.entities import Document  # type: ignore


class IDocumentParser(ABC):
    @abstractmethod
    async def parse(self, content: bytes, filename: str, mime_type: str) -> Tuple[str, Document]:
        """Parse raw bytes into extracted text and Document metadata."""
        ...
