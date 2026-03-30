"""
MsMarcoCrossEncoder — cross-encoder/ms-marco-MiniLM-L-6-v2 backend.
"""
import asyncio
import logging
from typing import List

from application.ports import IRerankerModel
from domain.entities import RerankCandidate, RerankedResult
from domain.errors import ModelLoadError, RerankError

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"


class MsMarcoCrossEncoder(IRerankerModel):
    def __init__(self, model_name: str = _DEFAULT_MODEL, device: str = "cpu") -> None:
        self._model_name = model_name
        self._device = device
        self._encoder = None

    def _load(self):
        if self._encoder is not None:
            return
        try:
            from sentence_transformers import CrossEncoder
            self._encoder = CrossEncoder(self._model_name, device=self._device)
            logger.info("MS-MARCO reranker loaded: %s", self._model_name)
        except Exception as exc:
            raise ModelLoadError(f"Failed to load MS-MARCO model: {exc}") from exc

    async def rerank(
        self,
        query: str,
        candidates: List[RerankCandidate],
        top_n: int,
    ) -> List[RerankedResult]:
        if not candidates:
            return []
        try:
            self._load()
            pairs = [(query, c.text) for c in candidates]
            loop = asyncio.get_event_loop()
            scores = await loop.run_in_executor(
                None, lambda: self._encoder.predict(pairs).tolist()
            )
        except ModelLoadError:
            raise
        except Exception as exc:
            raise RerankError(f"MS-MARCO reranking failed: {exc}") from exc

        scored = sorted(zip(candidates, scores), key=lambda x: x[1], reverse=True)
        results = []
        for new_rank, (candidate, score) in enumerate(scored[:top_n]):
            orig_rank = candidates.index(candidate)
            results.append(RerankedResult(
                id=candidate.id,
                text=candidate.text,
                score=float(score),
                original_rank=orig_rank,
                reranked_rank=new_rank,
                metadata=candidate.metadata,
            ))
        return results

    @property
    def model_name(self) -> str:
        return self._model_name
