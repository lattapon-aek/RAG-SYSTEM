"""
Knowledge Connector — Pydantic schemas for FastAPI interface.
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str


class PageMetadataRequest(BaseModel):
    url: str


class PageMetadataResponse(BaseModel):
    url: str
    title: str = ""
    description: str = ""
    author: str = ""
    published_at: Optional[str] = None
    canonical_url: str = ""
    site_name: str = ""
    language: str = ""
    keywords: List[str] = Field(default_factory=list)
    status_code: int = 200
    content_type: str = ""
    text_length: int = 0
    text_preview: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)


class StructuredQueryRequest(BaseModel):
    query: str
    connection_string: str
    engine: str = "sqlalchemy"


class StructuredQueryResponse(BaseModel):
    query: str
    rows: List[Dict[str, Any]]
    columns: List[str]
    row_count: int
    error: Optional[str] = None


class NewsArticleSchema(BaseModel):
    title: str
    url: str
    summary: str = ""
    published_at: Optional[str] = None
    source: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)


class IngestNewsFeedRequest(BaseModel):
    feed_url: str
    namespace: str = "default"
    max_items: int = 20


class BatchScrapeRequest(BaseModel):
    urls: List[str]
    namespace: str = "default"
    auto_ingest: bool = False
    include_text: bool = False
    max_concurrency: int = 3


class BatchScrapeItemSchema(BaseModel):
    url: str
    status: str
    title: str = ""
    description: str = ""
    author: str = ""
    published_at: Optional[str] = None
    canonical_url: str = ""
    site_name: str = ""
    language: str = ""
    keywords: List[str] = Field(default_factory=list)
    status_code: Optional[int] = None
    content_type: str = ""
    text_length: int = 0
    text_preview: str = ""
    text: str = ""
    reason: Optional[str] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    ingestion: Optional[Dict[str, Any]] = None


class BatchScrapeResponse(BaseModel):
    total: int
    succeeded: int
    failed: int
    namespace: str = "default"
    auto_ingest: bool = False
    items: List[BatchScrapeItemSchema] = Field(default_factory=list)
