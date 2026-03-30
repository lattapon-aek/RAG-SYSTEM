import logging

from fastapi import APIRouter, Depends, HTTPException

from application.extract_entities_use_case import ExtractEntitiesUseCase
from application.graph_query_use_case import GraphQueryUseCase
from domain.entities import GraphQuery
from domain.errors import GraphServiceUnavailableError, EntityExtractionError
from interface.dependencies import get_extract_use_case, get_query_use_case, get_repository
from interface.schemas import (
    ExtractRequest,
    ExtractResponse,
    GraphQueryRequest,
    GraphQueryResponse,
    EntityOut,
    RelationOut,
    StatsResponse,
    HealthResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/graph/extract", response_model=ExtractResponse)
async def extract_entities(
    req: ExtractRequest,
    use_case: ExtractEntitiesUseCase = Depends(get_extract_use_case),
):
    try:
        result = await use_case.execute(
            text=req.text,
            document_id=req.document_id,
            namespace=req.namespace,
            dry_run=req.dry_run,
        )
        return ExtractResponse(**result)
    except EntityExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/graph/query", response_model=GraphQueryResponse)
async def query_graph(
    req: GraphQueryRequest,
    use_case: GraphQueryUseCase = Depends(get_query_use_case),
):
    try:
        graph_query = GraphQuery(
            query_text=req.query_text,
            entity_names=req.entity_names,
            max_hops=req.max_hops,
            namespace=req.namespace,
        )
        result = await use_case.execute(graph_query)
        return GraphQueryResponse(
            entities=[EntityOut(**e.__dict__) for e in result.entities],
            relations=[RelationOut(**r.__dict__) for r in result.relations],
            context_text=result.context_text,
        )
    except GraphServiceUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.delete("/graph/documents/{document_id}", status_code=204)
async def delete_document_graph(
    document_id: str,
    namespace: str = "default",
    repo=Depends(get_repository),
):
    try:
        await repo.delete_by_document_id(document_id, namespace=namespace)
    except GraphServiceUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/graph/namespaces")
async def list_graph_namespaces(repo=Depends(get_repository)):
    """Return entity and relation counts per namespace."""
    try:
        return await repo.list_namespaces()
    except GraphServiceUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/graph/stats", response_model=StatsResponse)
async def get_stats(repo=Depends(get_repository)):
    try:
        stats = await repo.get_stats()
        return StatsResponse(**stats)
    except GraphServiceUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.delete("/graph/namespaces/{namespace}", status_code=200)
async def delete_namespace_graph(namespace: str, repo=Depends(get_repository)):
    """Delete all graph entities and relations for a namespace."""
    try:
        result = await repo.delete_by_namespace(namespace)
        return {"status": "deleted", "namespace": namespace, **result}
    except GraphServiceUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/graph/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="healthy")
