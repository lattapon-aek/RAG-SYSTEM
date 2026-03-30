"""
HuggingFace Embedding Service adapter (local sentence-transformers)
Uses CPU-only to avoid CUDA dependency issues.
"""
import logging
from typing import List

from application.ports.i_embedding_service import IEmbeddingService

logger = logging.getLogger(__name__)


class HuggingFaceEmbeddingService(IEmbeddingService):
    """Embedding via sentence-transformers (runs locally on CPU)."""

    def __init__(self, model: str = "sentence-transformers/all-MiniLM-L6-v2",
                 device: str = "cpu"):
        try:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(model, device=device)
            self._model_name = model
        except ImportError:
            raise ImportError(
                "sentence-transformers required: pip install sentence-transformers"
            )

    async def embed(self, text: str) -> List[float]:
        results = await self.embed_batch([text])
        return results[0]

    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        # SentenceTransformer.encode is synchronous — run in thread pool
        import asyncio
        loop = asyncio.get_event_loop()
        embeddings = await loop.run_in_executor(
            None,
            lambda: self._model.encode(texts, convert_to_numpy=True).tolist()
        )
        return embeddings
