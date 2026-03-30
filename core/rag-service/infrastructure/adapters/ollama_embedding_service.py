"""
Ollama Embedding Service adapter (default local provider)
"""
import asyncio
import logging
from typing import List

import httpx

from application.ports.i_embedding_service import IEmbeddingService

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0


class OllamaEmbeddingService(IEmbeddingService):
    def __init__(self, base_url: str = "http://ollama:11434",
                 model: str = "bge-m3"):
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def embed(self, text: str) -> List[float]:
        results = await self.embed_batch([text])
        return results[0]

    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        embeddings: List[List[float]] = []
        for text in texts:
            embedding = await self._embed_single(text)
            embeddings.append(embedding)
        return embeddings

    async def _embed_single(self, text: str) -> List[float]:
        last_error: Exception = RuntimeError("No attempts made")
        for attempt in range(_MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=300.0) as client:
                    # /api/embed (new API, Ollama >= 0.1.26)
                    response = await client.post(
                        f"{self._base_url}/api/embed",
                        json={"model": self._model, "input": text, "keep_alive": -1},
                    )
                    response.raise_for_status()
                    data = response.json()
                    # new API returns {"embeddings": [[...]]}
                    if "embeddings" in data:
                        return data["embeddings"][0]
                    # legacy fallback
                    return data["embedding"]
            except Exception as exc:
                last_error = exc
                wait = _BACKOFF_BASE ** attempt
                logger.warning("Ollama embed attempt %d failed: %s — retrying in %.1fs",
                               attempt + 1, exc, wait)
                await asyncio.sleep(wait)
        raise last_error
