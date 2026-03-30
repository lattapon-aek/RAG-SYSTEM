from abc import ABC, abstractmethod
from typing import List


class IEmbeddingService(ABC):
    @abstractmethod
    async def embed(self, text: str) -> List[float]:
        ...

    @abstractmethod
    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        ...
