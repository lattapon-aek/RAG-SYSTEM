from abc import ABC, abstractmethod
from domain.entities import PageMetadata, ScrapedPage


class IWebScraper(ABC):
    @abstractmethod
    async def scrape(self, url: str) -> ScrapedPage:
        """Scrape a URL and return clean text content."""

    @abstractmethod
    async def inspect(self, url: str) -> PageMetadata:
        """Inspect a URL and return metadata without requiring downstream ingestion."""
