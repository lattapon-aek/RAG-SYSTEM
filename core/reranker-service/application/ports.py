"""
Reranker Service — Application Ports
"""
from abc import ABC, abstractmethod
from typing import List

from domain.entities import RerankCandidate, RerankedResult


class IRerankerModel(ABC):
    """Port for a reranker backend model."""

    @abstractmethod
    async def rerank(
        self,
        query: str,
        candidates: List[RerankCandidate],
        top_n: int,
    ) -> List[RerankedResult]:
        """Rerank candidates and return top_n results."""

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Human-readable model identifier."""
