"""
RerankCandidatesUseCase — orchestrates reranking via the configured backend.
"""
import time
from typing import List

from application.ports import IRerankerModel
from domain.entities import RerankCandidate, RerankRequest, RerankResponse, RerankedResult


class RerankCandidatesUseCase:
    def __init__(self, model: IRerankerModel) -> None:
        self._model = model

    async def execute(self, request: RerankRequest) -> RerankResponse:
        t0 = time.monotonic()
        results: List[RerankedResult] = await self._model.rerank(
            query=request.query,
            candidates=request.candidates,
            top_n=request.top_n,
        )
        latency_ms = (time.monotonic() - t0) * 1000
        return RerankResponse(
            results=results,
            model=self._model.model_name,
            latency_ms=latency_ms,
        )
