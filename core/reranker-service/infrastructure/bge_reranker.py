"""
BGERerankerModel — BAAI/bge-reranker-base via sentence-transformers CrossEncoder.
Default reranker backend.
"""
import asyncio
import logging
import os
from typing import List

from application.ports import IRerankerModel
from domain.entities import RerankCandidate, RerankedResult
from domain.errors import ModelLoadError, RerankError

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = "BAAI/bge-reranker-base"


class BGERerankerModel(IRerankerModel):
    def __init__(self, model_name: str = _DEFAULT_MODEL, device: str = "cpu") -> None:
        self._model_name = model_name
        self._device = device
        self._encoder = None
        self._batch_size = int(os.getenv("RERANKER_BATCH_SIZE", "4"))
        self._max_length = int(os.getenv("RERANKER_MAX_LENGTH", "256"))
        self._max_candidates = int(os.getenv("RERANKER_MAX_CANDIDATES", "4"))
        self._max_query_chars = int(os.getenv("RERANKER_MAX_QUERY_CHARS", "256"))
        self._max_text_chars = int(os.getenv("RERANKER_MAX_TEXT_CHARS", "600"))

    def _load(self):
        if self._encoder is not None:
            return
        try:
            from sentence_transformers import CrossEncoder
            self._encoder = CrossEncoder(
                self._model_name,
                device=self._device,
                max_length=self._max_length,
            )
            logger.info("BGE reranker loaded: %s on %s", self._model_name, self._device)
        except Exception as exc:
            raise ModelLoadError(f"Failed to load BGE model '{self._model_name}': {exc}") from exc

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
            query_text = query[:self._max_query_chars].strip()
            limited_candidates = candidates[:self._max_candidates]
            pairs = [
                (query_text, c.text[:self._max_text_chars].strip())
                for c in limited_candidates
            ]
            # Run CPU-bound scoring in thread pool
            loop = asyncio.get_event_loop()
            scores = await loop.run_in_executor(
                None,
                lambda: self._encoder.predict(
                    pairs,
                    batch_size=min(self._batch_size, len(pairs)),
                    show_progress_bar=False,
                ).tolist(),
            )
        except ModelLoadError:
            raise
        except Exception as exc:
            raise RerankError(f"BGE reranking failed: {exc}") from exc

        scored = sorted(
            zip(limited_candidates, scores),
            key=lambda x: x[1],
            reverse=True,
        )
        results = []
        for new_rank, (candidate, score) in enumerate(scored[:top_n]):
            orig_rank = limited_candidates.index(candidate)
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
