"""
NoOpReranker — pass-through, returns candidates in original order.
Used as fallback when no model is configured.
"""
from typing import List

from application.ports import IRerankerModel
from domain.entities import RerankCandidate, RerankedResult


class NoOpReranker(IRerankerModel):
    async def rerank(
        self,
        query: str,
        candidates: List[RerankCandidate],
        top_n: int,
    ) -> List[RerankedResult]:
        results = []
        for i, c in enumerate(candidates[:top_n]):
            results.append(RerankedResult(
                id=c.id,
                text=c.text,
                score=c.score,
                original_rank=i,
                reranked_rank=i,
                metadata=c.metadata,
            ))
        return results

    @property
    def model_name(self) -> str:
        return "noop"
