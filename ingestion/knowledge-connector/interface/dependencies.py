"""
Knowledge Connector — FastAPI dependency injection.
"""
import os
from functools import lru_cache

from application.use_cases import (
    BatchScrapeUseCase, IngestNewsFeedUseCase, NewsFeedUseCase,
    PageMetadataUseCase, StructuredQueryUseCase,
)
from infrastructure.crawl4ai_adapter import Crawl4AIAdapter
from infrastructure.duckdb_adapter import DuckDBAdapter
from infrastructure.feedparser_adapter import FeedparserAdapter
from infrastructure.ingestion_http_client import IngestionServiceHttpClient
from infrastructure.sqlalchemy_adapter import SQLAlchemyAdapter


@lru_cache(maxsize=1)
def _get_page_metadata_use_case() -> PageMetadataUseCase:
    blocklist = os.getenv("SCRAPE_DOMAIN_BLOCKLIST",
                          "localhost,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    return PageMetadataUseCase(scraper=Crawl4AIAdapter(blocklist=blocklist))


@lru_cache(maxsize=1)
def _get_structured_query_use_case() -> StructuredQueryUseCase:
    return StructuredQueryUseCase(
        sql_engine=SQLAlchemyAdapter(),
        duckdb_engine=DuckDBAdapter(),
    )


@lru_cache(maxsize=1)
def _get_news_feed_use_case() -> NewsFeedUseCase:
    return NewsFeedUseCase(parser=FeedparserAdapter())


@lru_cache(maxsize=1)
def _get_batch_scrape_use_case() -> BatchScrapeUseCase:
    blocklist = os.getenv("SCRAPE_DOMAIN_BLOCKLIST",
                          "localhost,169.254.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    ingestion_url = os.getenv("INGESTION_SERVICE_URL", "http://ingestion-service:8001")
    return BatchScrapeUseCase(
        scraper=Crawl4AIAdapter(blocklist=blocklist),
        ingestion_client=IngestionServiceHttpClient(base_url=ingestion_url),
    )


def get_page_metadata_use_case() -> PageMetadataUseCase:
    return _get_page_metadata_use_case()


def get_structured_query_use_case() -> StructuredQueryUseCase:
    return _get_structured_query_use_case()


def get_news_feed_use_case() -> NewsFeedUseCase:
    return _get_news_feed_use_case()


def get_batch_scrape_use_case() -> BatchScrapeUseCase:
    return _get_batch_scrape_use_case()


@lru_cache(maxsize=1)
def _get_ingest_news_feed_use_case() -> IngestNewsFeedUseCase:
    ingestion_url = os.getenv("INGESTION_SERVICE_URL", "http://ingestion-service:8001")
    return IngestNewsFeedUseCase(
        parser=FeedparserAdapter(),
        ingestion_client=IngestionServiceHttpClient(base_url=ingestion_url),
    )


def get_ingest_news_feed_use_case() -> IngestNewsFeedUseCase:
    return _get_ingest_news_feed_use_case()
