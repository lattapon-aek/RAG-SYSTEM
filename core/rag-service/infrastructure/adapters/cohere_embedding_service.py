"""
Cohere Embedding Service adapter
"""
import asyncio
import logging
from typing import List

from application.ports.i_embedding_service import IEmbeddingService

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0


class CohereEmbeddingService(IEmbeddingService):
    def __init__(self, api_key: str,
                 model: str = "embed-english-v3.0",
                 input_type: str = "search_document"):
        try:
            import cohere
            self._client = cohere.AsyncClient(api_key=api_key)
        except ImportError:
            raise ImportError("cohere package required: pip install cohere")
        self._model = model
        self._input_type = input_type

    async def embed(self, text: str) -> List[float]:
        results = await self.embed_batch([text])
        return results[0]

    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        last_error: Exception = RuntimeError("No attempts made")
        for attempt in range(_MAX_RETRIES):
            try:
                response = await self._client.embed(
                    texts=texts,
                    model=self._model,
                    input_type=self._input_type,
                )
                return [list(e) for e in response.embeddings]
            except Exception as exc:
                last_error = exc
                wait = _BACKOFF_BASE ** attempt
                logger.warning("Cohere embed attempt %d failed: %s — retrying in %.1fs",
                               attempt + 1, exc, wait)
                await asyncio.sleep(wait)
        raise last_error
