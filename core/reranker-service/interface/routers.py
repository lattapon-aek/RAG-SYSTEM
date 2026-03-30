"""
Reranker Service — FastAPI routers.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, status

from application.rerank_use_case import RerankCandidatesUseCase
from domain.entities import RerankCandidate, RerankRequest
from domain.errors import ModelLoadError, RerankError
from interface.dependencies import get_rerank_use_case, get_model
from interface.schemas import (
    RerankRequestSchema, RerankResponseSchema, RerankedResultSchema, HealthResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(model=Depends(get_model)):
    return HealthResponse(status="healthy", model=model.model_name)


@router.post("/rerank", response_model=RerankResponseSchema)
async def rerank(
    req: RerankRequestSchema,
    use_case: RerankCandidatesUseCase = Depends(get_rerank_use_case),
):
    if not req.query.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Query must not be empty")
    if not req.candidates:
        return RerankResponseSchema(results=[], model="", latency_ms=0.0)

    candidates = [
        RerankCandidate(id=c.id, text=c.text, score=c.score, metadata=c.metadata)
        for c in req.candidates
    ]
    domain_req = RerankRequest(
        query=req.query,
        candidates=candidates,
        top_n=req.top_n,
    )

    try:
        response = await use_case.execute(domain_req)
    except ModelLoadError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail=str(exc))
    except RerankError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=str(exc))

    return RerankResponseSchema(
        results=[
            RerankedResultSchema(
                id=r.id,
                text=r.text,
                score=r.score,
                original_rank=r.original_rank,
                reranked_rank=r.reranked_rank,
                metadata=r.metadata,
            )
            for r in response.results
        ],
        model=response.model,
        latency_ms=response.latency_ms,
    )
