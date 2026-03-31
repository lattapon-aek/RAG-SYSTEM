from abc import ABC, abstractmethod


class IIngestionServiceClient(ABC):
    @abstractmethod
    async def ingest_text(self, content: str, metadata: dict) -> str:
        """Ingest text content, return document_id"""
        ...
