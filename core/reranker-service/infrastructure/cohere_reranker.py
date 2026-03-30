"""
CohereRerankAdapter — uses Cohere Rerank API.
"""
import logging
from typing import List

from application.ports import IRerankerModel
from domain.entities import RerankCandidate, RerankedResult
from domain.errors import RerankError

logger = logging.getLogger(__name__)


class CohereRerankAdapter(IRerankerModel):
    def __init__(self, api_key: str, model: str = "rerank-english-v3.0") -> None:
        self._api_key = api_key
        self._model = model
        self._client = None

    def _get_client(self):
        if self._client is None:
            import cohere
            self._client = cohere.Client(self._api_key)
        return self._client

    async def rerank(
        self,
        query: str,
        candidates: List[RerankCandidate],
        top_n: int,
    ) -> List[RerankedResult]:
        if not candidates:
            return []
        try:
            import asyncio
            client = self._get_client()
            docs = [c.text for c in candidates]
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: client.rerank(
                    query=query,
                    documents=docs,
                    top_n=top_n,
                    model=self._model,
                ),
            )
        except Exception as exc:
            raise RerankError(f"Cohere reranking failed: {exc}") from exc

        results = []
        for new_rank, item in enumerate(response.results):
            orig_rank = item.index
            candidate = candidates[orig_rank]
            results.append(RerankedResult(
                id=candidate.id,
                text=candidate.text,
                score=float(item.relevance_score),
                original_rank=orig_rank,
                reranked_rank=new_rank,
                metadata=candidate.metadata,
            ))
        return results

    @property
    def model_name(self) -> str:
        return f"cohere/{self._model}"
