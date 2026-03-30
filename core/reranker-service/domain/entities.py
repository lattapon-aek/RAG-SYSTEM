"""
Reranker Service — Domain Entities
"""
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class RerankCandidate:
    """A single candidate document/chunk to be reranked."""
    id: str
    text: str
    score: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RerankedResult:
    """A candidate after reranking with updated score and rank."""
    id: str
    text: str
    score: float
    original_rank: int
    reranked_rank: int
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RerankRequest:
    """Input to the reranker."""
    query: str
    candidates: list  # List[RerankCandidate]
    top_n: int = 5


@dataclass
class RerankResponse:
    """Output from the reranker."""
    results: list  # List[RerankedResult]
    model: str
    latency_ms: float = 0.0
