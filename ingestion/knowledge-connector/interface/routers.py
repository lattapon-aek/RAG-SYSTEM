"""
Knowledge Connector — FastAPI routers.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status

from application.use_cases import (
    BatchScrapeUseCase, IngestNewsFeedUseCase, NewsFeedUseCase,
    PageMetadataUseCase, StructuredQueryUseCase,
)
from domain.errors import (
    FeedParseError, IngestionServiceError, StructuredQueryError,
)
from interface.dependencies import (
    get_batch_scrape_use_case, get_ingest_news_feed_use_case,
    get_news_feed_use_case, get_page_metadata_use_case, get_structured_query_use_case,
)
from interface.schemas import (
    BatchScrapeRequest, BatchScrapeResponse, HealthResponse, IngestNewsFeedRequest,
    NewsArticleSchema, PageMetadataRequest, PageMetadataResponse, StructuredQueryRequest,
    StructuredQueryResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="healthy", service="knowledge-connector")


@router.post("/knowledge/page-metadata", response_model=PageMetadataResponse)
async def page_metadata(
    req: PageMetadataRequest,
    use_case: PageMetadataUseCase = Depends(get_page_metadata_use_case),
):
    try:
        metadata = await use_case.execute(req.url)
        return PageMetadataResponse(
            url=metadata.url,
            title=metadata.title,
            description=metadata.description,
            author=metadata.author,
            published_at=metadata.published_at,
            canonical_url=metadata.canonical_url,
            site_name=metadata.site_name,
            language=metadata.language,
            keywords=metadata.keywords,
            status_code=metadata.status_code,
            content_type=metadata.content_type,
            text_length=metadata.text_length,
            text_preview=metadata.text_preview,
            metadata=metadata.metadata,
        )
    except BlockedDomainError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except ScrapingError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.post("/knowledge/query-db", response_model=StructuredQueryResponse)
async def query_db(
    req: StructuredQueryRequest,
    use_case: StructuredQueryUseCase = Depends(get_structured_query_use_case),
):
    try:
        result = await use_case.execute(req.query, req.connection_string, engine=req.engine)
        return StructuredQueryResponse(
            query=result.query,
            rows=result.rows,
            columns=result.columns,
            row_count=result.row_count,
            error=result.error,
        )
    except StructuredQueryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/knowledge/news-feed", response_model=list)
async def news_feed(
    feed_url: str = Query(..., description="RSS/Atom feed URL"),
    max_items: int = Query(20, ge=1, le=100),
    use_case: NewsFeedUseCase = Depends(get_news_feed_use_case),
):
    try:
        articles = await use_case.execute(feed_url, max_items=max_items)
        return [NewsArticleSchema(**a.__dict__).model_dump() for a in articles]
    except FeedParseError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.post("/knowledge/ingest-news", status_code=status.HTTP_201_CREATED)
async def ingest_news_feed(
    req: IngestNewsFeedRequest,
    use_case: IngestNewsFeedUseCase = Depends(get_ingest_news_feed_use_case),
):
    """Fetch RSS/Atom feed and ingest articles with 3-day TTL from publication date."""
    try:
        result = await use_case.execute(
            feed_url=req.feed_url,
            namespace=req.namespace,
            max_items=req.max_items,
        )
        return result
    except FeedParseError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except IngestionServiceError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))


@router.post("/knowledge/batch-scrape", response_model=BatchScrapeResponse)
async def batch_scrape(
    req: BatchScrapeRequest,
    use_case: BatchScrapeUseCase = Depends(get_batch_scrape_use_case),
):
    try:
        result = await use_case.execute(
            urls=req.urls,
            namespace=req.namespace,
            auto_ingest=req.auto_ingest,
            include_text=req.include_text,
            max_concurrency=req.max_concurrency,
        )
        return BatchScrapeResponse(**result)
    except ScrapingError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    except IngestionServiceError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
