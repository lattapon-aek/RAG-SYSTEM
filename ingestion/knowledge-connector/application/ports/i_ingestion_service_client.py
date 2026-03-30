from abc import ABC, abstractmethod
from typing import Optional


class IIngestionServiceClient(ABC):
    @abstractmethod
    async def ingest_text(
        self,
        text: str,
        filename: str,
        namespace: str = "default",
        source_url: Optional[str] = None,
        content_source: str = "web",
        expires_in_days: Optional[int] = None,
    ) -> dict:
        """Send text content to the ingestion service."""
