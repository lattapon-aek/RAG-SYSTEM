"""
RAG Service domain entities
"""
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from datetime import datetime


@dataclass
class Document:
    id: str
    filename: str
    content_type: str
    source_hash: str
    namespace: str = "default"
    ingested_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    chunk_count: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Chunk:
    id: str
    document_id: str
    text: str
    token_count: int
    sequence_index: int
    chunk_type: str = "flat"          # flat | parent | child
    parent_chunk_id: Optional[str] = None
    namespace: str = "default"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class HierarchicalChunk(Chunk):
    children: List["HierarchicalChunk"] = field(default_factory=list)


@dataclass
class Citation:
    chunk_id: str
    document_id: str
    filename: str
    text_snippet: str
    score: float
    sequence_index: int


@dataclass
class QueryResult:
    request_id: str
    answer: str
    citations: List[Citation]
    graph_entities: List[Dict[str, Any]] = field(default_factory=list)
    graph_seed_names: List[str] = field(default_factory=list)
    rewritten_query: Optional[str] = None
    hyde_used: bool = False
    sub_queries: List[str] = field(default_factory=list)
    tool_calls: List["ToolCall"] = field(default_factory=list)
    from_cache: bool = False
    retrieval_latency_ms: float = 0.0
    generation_latency_ms: float = 0.0
    total_latency_ms: float = 0.0
    confidence_score: float = 1.0
    grounding_score: float = 1.0
    low_confidence: bool = False
    # pipeline stage metadata (plain dicts — no Pydantic dependency in domain layer)
    stages: List[Dict[str, Any]] = field(default_factory=list)
    memory_context_chars: int = 0
    knowledge_gap: bool = False
    top_rerank_score: float = 0.0


@dataclass
class RerankedResult:
    chunk_id: str
    document_id: str
    text: str
    score: float
    original_rank: int
    reranked_rank: int
    namespace: str = "default"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BuiltContext:
    chunks: List[RerankedResult]
    total_tokens: int
    was_truncated: bool = False


@dataclass
class CompressedContext:
    text: str
    original_tokens: int
    compressed_tokens: int
    method: str = "none"   # none | extractive | llm


@dataclass
class QueryIntelligenceResult:
    original_query: str
    rewritten_query: str
    hyde_document: Optional[str] = None
    sub_queries: List[str] = field(default_factory=list)
    hyde_used: bool = False


@dataclass
class FeedbackRecord:
    request_id: str
    user_id: Optional[str]
    feedback_score: float          # 0.0 – 1.0
    comment: Optional[str] = None
    created_at: Optional[datetime] = None


@dataclass
class EvaluationResult:
    request_id: str
    faithfulness: float
    answer_relevance: float
    context_precision: float
    context_recall: float
    evaluated_at: Optional[datetime] = None


@dataclass
class ToolCall:
    tool_name: str
    input: Dict[str, Any]
    output: Any
    timestamp: Optional[datetime] = None


@dataclass
class ToolResult:
    tool_name: str
    success: bool
    output: Any
    error: Optional[str] = None
