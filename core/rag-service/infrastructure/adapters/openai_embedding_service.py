"""
OpenAI Embedding Service adapter with retry logic
"""
import asyncio
import logging
from typing import List

from application.ports.i_embedding_service import IEmbeddingService

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0  # seconds


class OpenAIEmbeddingService(IEmbeddingService):
    def __init__(self, api_key: str, model: str = "text-embedding-ada-002"):
        try:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=api_key)
        except ImportError:
            raise ImportError("openai package required: pip install openai")
        self._model = model

    async def embed(self, text: str) -> List[float]:
        results = await self.embed_batch([text])
        return results[0]

    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        last_error: Exception = RuntimeError("No attempts made")
        for attempt in range(_MAX_RETRIES):
            try:
                response = await self._client.embeddings.create(
                    model=self._model,
                    input=texts,
                )
                return [item.embedding for item in response.data]
            except Exception as exc:
                last_error = exc
                wait = _BACKOFF_BASE ** attempt
                logger.warning("Embedding attempt %d failed: %s — retrying in %.1fs",
                               attempt + 1, exc, wait)
                await asyncio.sleep(wait)
        raise last_error
