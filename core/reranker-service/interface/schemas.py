"""
Reranker Service — Pydantic schemas for FastAPI interface.
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class CandidateIn(BaseModel):
    id: str
    text: str
    score: float = 0.0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RerankRequestSchema(BaseModel):
    query: str
    candidates: List[CandidateIn]
    top_n: int = 5


class RerankedResultSchema(BaseModel):
    id: str
    text: str
    score: float
    original_rank: int
    reranked_rank: int
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RerankResponseSchema(BaseModel):
    results: List[RerankedResultSchema]
    model: str
    latency_ms: float


class HealthResponse(BaseModel):
    status: str
    model: str
