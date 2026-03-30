"""
Knowledge Connector — Domain Entities
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ScrapedPage:
    url: str
    title: str
    text: str
    html: str = ""
    status_code: int = 200
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PageMetadata:
    url: str
    title: str = ""
    description: str = ""
    author: str = ""
    published_at: Optional[str] = None
    canonical_url: str = ""
    site_name: str = ""
    language: str = ""
    keywords: List[str] = field(default_factory=list)
    status_code: int = 200
    content_type: str = ""
    text_length: int = 0
    text_preview: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class StructuredQueryResult:
    query: str
    rows: List[Dict[str, Any]] = field(default_factory=list)
    columns: List[str] = field(default_factory=list)
    row_count: int = 0
    error: Optional[str] = None


@dataclass
class NewsArticle:
    title: str
    url: str
    summary: str
    published: Optional[str] = None
    source: str = ""
    content: str = ""
