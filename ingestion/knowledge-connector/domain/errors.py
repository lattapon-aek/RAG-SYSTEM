"""
Knowledge Connector — Domain Errors
"""


class KnowledgeConnectorError(Exception):
    """Base error."""


class SearchEngineUnavailableError(KnowledgeConnectorError):
    """SearXNG or search engine is unavailable."""


class ScrapingError(KnowledgeConnectorError):
    """Web scraping failed."""


class BlockedDomainError(KnowledgeConnectorError):
    """Target domain is in the blocklist."""


class StructuredQueryError(KnowledgeConnectorError):
    """SQL/DuckDB query failed."""


class FeedParseError(KnowledgeConnectorError):
    """RSS/Atom feed parsing failed."""


class IngestionServiceError(KnowledgeConnectorError):
    """Ingestion service call failed."""
