"""
Knowledge Connector — Use Cases
"""
import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from application.ports.i_ingestion_service_client import IIngestionServiceClient
from application.ports.i_news_feed_parser import INewsFeedParser
from application.ports.i_structured_query_engine import IStructuredQueryEngine
from application.ports.i_web_scraper import IWebScraper
from domain.entities import NewsArticle, PageMetadata, StructuredQueryResult, ScrapedPage

logger = logging.getLogger(__name__)


class PageMetadataUseCase:
    def __init__(self, scraper: IWebScraper) -> None:
        self._scraper = scraper

    async def execute(self, url: str) -> PageMetadata:
        return await self._scraper.inspect(url)


class StructuredQueryUseCase:
    def __init__(self, sql_engine: IStructuredQueryEngine,
                 duckdb_engine: IStructuredQueryEngine) -> None:
        self._sql = sql_engine
        self._duckdb = duckdb_engine

    async def execute(
        self, query: str, connection_string: str, engine: str = "sql"
    ) -> StructuredQueryResult:
        if engine == "duckdb":
            return await self._duckdb.execute(query, connection_string)
        return await self._sql.execute(query, connection_string)


class NewsFeedUseCase:
    def __init__(self, parser: INewsFeedParser) -> None:
        self._parser = parser

    async def execute(self, feed_url: str, max_items: int = 20) -> List[NewsArticle]:
        return await self._parser.parse(feed_url, max_items=max_items)


def _get_news_ttl() -> int:
    return int(os.getenv("NEWS_TTL_DAYS", "3"))


class IngestNewsFeedUseCase:
    """Fetch RSS/Atom feed and ingest each article with TTL derived from publication date."""

    def __init__(
        self,
        parser: INewsFeedParser,
        ingestion_client: IIngestionServiceClient,
    ) -> None:
        self._parser = parser
        self._ingestion = ingestion_client

    async def execute(
        self,
        feed_url: str,
        namespace: str = "default",
        max_items: int = 20,
    ) -> dict:
        articles = await self._parser.parse(feed_url, max_items=max_items)
        ingested, skipped = 0, 0
        now = datetime.now(timezone.utc)

        news_ttl = _get_news_ttl()
        for article in articles:
            text = article.content or article.summary
            if not text.strip():
                skipped += 1
                continue

            # TTL from publication date + NEWS_TTL_DAYS; fallback to now + TTL
            expires_in_days = news_ttl
            if article.published:
                try:
                    pub = datetime.fromisoformat(article.published)
                    if pub.tzinfo is None:
                        pub = pub.replace(tzinfo=timezone.utc)
                    expires_dt = pub + timedelta(days=news_ttl)
                    # expires_in_days relative to now (may be negative = already expired)
                    delta = (expires_dt - now).days
                    if delta <= 0:
                        skipped += 1
                        continue  # article already past TTL
                    expires_in_days = delta
                except (ValueError, TypeError):
                    pass

            filename = (article.url.split("/")[-1] or "article").replace(".html", "") + ".txt"
            try:
                await self._ingestion.ingest_text(
                    text=text,
                    filename=filename,
                    namespace=namespace,
                    source_url=article.url,
                    content_source="rss",
                    expires_in_days=expires_in_days,
                )
                ingested += 1
            except Exception as exc:
                logger.warning("Failed to ingest article %s: %s", article.url, exc)
                skipped += 1

        return {"ingested": ingested, "skipped": skipped, "feed_url": feed_url}


class BatchScrapeUseCase:
    def __init__(
        self,
        scraper: IWebScraper,
        ingestion_client: IIngestionServiceClient,
    ) -> None:
        self._scraper = scraper
        self._ingestion = ingestion_client

    async def execute(
        self,
        urls: List[str],
        namespace: str = "default",
        auto_ingest: bool = False,
        include_text: bool = False,
        max_concurrency: int = 3,
    ) -> dict:
        unique_urls = []
        seen: set[str] = set()
        for raw_url in urls:
            url = raw_url.strip()
            if not url or url in seen:
                continue
            seen.add(url)
            unique_urls.append(url)

        if not unique_urls:
            return {"total": 0, "succeeded": 0, "failed": 0, "items": []}

        semaphore = asyncio.Semaphore(max(1, min(max_concurrency, 6)))

        async def handle(url: str) -> dict:
            async with semaphore:
                try:
                    if auto_ingest:
                        page = await self._scraper.scrape(url)
                        if not page.text.strip():
                            return {
                                "url": url,
                                "status": "skipped",
                                "reason": "empty content",
                                "title": page.title,
                                "text_length": len(page.text),
                            }

                        filename = url.split("/")[-1] or "scraped.txt"
                        if not filename.endswith(".txt"):
                            filename += ".txt"

                        result = await self._ingestion.ingest_text(
                            text=page.text,
                            filename=filename,
                            namespace=namespace,
                            source_url=url,
                            content_source="web",
                            expires_in_days=_get_web_ttl(),
                        )
                        return {
                            "url": url,
                            "status": "ingested",
                            "title": page.title,
                            "text_length": len(page.text),
                            "text_preview": page.text[:1000],
                            "metadata": page.metadata,
                            "ingestion": result,
                        }

                    if include_text:
                        page = await self._scraper.scrape(url)
                        if not page.text.strip():
                            return {
                                "url": url,
                                "status": "skipped",
                                "reason": "empty content",
                                "title": page.title,
                                "text_length": len(page.text),
                            }
                        return {
                            "url": url,
                            "status": "scraped",
                            "title": page.title,
                            "description": page.metadata.get("description", ""),
                            "author": page.metadata.get("author", ""),
                            "published_at": page.metadata.get("published_at"),
                            "canonical_url": page.metadata.get("canonical_url", url),
                            "site_name": page.metadata.get("site_name", ""),
                            "language": page.metadata.get("language", ""),
                            "keywords": page.metadata.get("keywords", []),
                            "status_code": page.status_code,
                            "content_type": page.metadata.get("content_type", ""),
                            "text_length": len(page.text),
                            "text_preview": page.text[:1000],
                            "text": page.text,
                            "metadata": page.metadata,
                        }

                    metadata = await self._scraper.inspect(url)
                    return {
                        "url": url,
                        "status": "previewed",
                        "title": metadata.title,
                        "description": metadata.description,
                        "author": metadata.author,
                        "published_at": metadata.published_at,
                        "canonical_url": metadata.canonical_url,
                        "site_name": metadata.site_name,
                        "language": metadata.language,
                        "keywords": metadata.keywords,
                        "status_code": metadata.status_code,
                        "content_type": metadata.content_type,
                        "text_length": metadata.text_length,
                        "text_preview": metadata.text_preview,
                        "metadata": metadata.metadata,
                    }
                except Exception as exc:
                    return {"url": url, "status": "failed", "error": str(exc)}

        items = await asyncio.gather(*(handle(url) for url in unique_urls))
        succeeded = sum(1 for item in items if item.get("status") in {"previewed", "ingested", "skipped"})
        failed = sum(1 for item in items if item.get("status") == "failed")
        return {
            "total": len(unique_urls),
            "succeeded": succeeded,
            "failed": failed,
            "namespace": namespace,
            "auto_ingest": auto_ingest,
            "include_text": include_text,
            "items": items,
        }
