from typing import Optional, List, Dict, Any
from pydantic import BaseModel, field_validator, model_validator


class QueryRequest(BaseModel):
    query: str
    namespace: str = "default"
    namespaces: Optional[List[str]] = None  # multi-namespace; overrides namespace when set
    client_id: Optional[str] = None
    user_id: Optional[str] = None
    top_k: int = 10
    top_n_rerank: int = 5
    use_cache: bool = True
    force_refresh: bool = False
    use_memory: bool = False
    use_hyde: bool = False
    use_rewrite: bool = False
    use_decompose: bool = False
    use_graph: bool = True

    @field_validator("query")
    @classmethod
    def query_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("query must not be empty or whitespace")
        return v

    @field_validator("namespaces")
    @classmethod
    def namespaces_max_five(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None and len(v) > 5:
            raise ValueError("namespaces list must not exceed 5 entries")
        return v


class NamespaceDescriptionRequest(BaseModel):
    description: Optional[str] = None


class CitationResponse(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    text_snippet: str
    score: float
    sequence_index: int


class QueryResponse(BaseModel):
    request_id: str
    answer: str
    citations: List[CitationResponse]
    graph_entities: List[Dict[str, Any]] = []
    graph_summary_texts: List[str] = []
    graph_seed_names: List[str] = []
    graph_seed_source: str = "empty"
    graph_seed_strategy: str = "none"
    rewritten_query: Optional[str] = None
    hyde_used: bool = False
    sub_queries: List[str] = []
    from_cache: bool = False
    retrieval_latency_ms: float = 0.0
    answer_latency_ms: float = 0.0
    total_latency_ms: float = 0.0
    grounding_score: float = 1.0
    low_confidence: bool = False
    # --- stage metadata (new) ---
    stages: List["StageTimingInfo"] = []
    memory_context_chars: int = 0
    knowledge_gap: bool = False
    top_rerank_score: float = 0.0


class FeedbackRequest(BaseModel):
    request_id: str
    feedback_score: float
    comment: Optional[str] = None
    user_id: Optional[str] = None


class DocumentResponse(BaseModel):
    id: str
    filename: str
    content_type: str
    namespace: str
    chunk_count: int
    ingested_at: Optional[str] = None


class MemoryGetRequest(BaseModel):
    user_id: str
    query: str = ""


class MemorySaveRequest(BaseModel):
    user_id: str
    content: str
    metadata: Optional[Dict[str, Any]] = None


class MemoryProfileCreateRequest(BaseModel):
    user_id: str
    label: Optional[str] = None
    notes: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    service: str = "rag-service"


class CircuitBreakerStatus(BaseModel):
    name: str
    state: str          # closed | open | half_open
    failure_count: int


class RateLimitStats(BaseModel):
    active_clients: int = 0
    default_rpm: int = 0
    top_clients: List[Dict[str, Any]] = []


class QuotaUpdateRequest(BaseModel):
    daily_limit: int

    @field_validator("daily_limit")
    @classmethod
    def daily_limit_not_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("daily_limit must be >= 0")
        return v


class RateLimitUpdateRequest(BaseModel):
    rpm_limit: int
    notes: Optional[str] = None

    @field_validator("rpm_limit")
    @classmethod
    def rpm_limit_not_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("rpm_limit must be >= 0")
        return v


class KnowledgeGapResponse(BaseModel):
    id: str
    query_text: str
    namespace: str
    top_score: float
    threshold: float
    occurrence_count: int = 1
    logged_at: str
    last_seen: str
    status: str  # open | promoted | ignored


class StageTimingInfo(BaseModel):
    stage: str          # "cache" | "short_memory" | "long_memory" | "q_intel"
                        # "embed" | "vector" | "graph" | "rerank" | "context" | "llm"
    fired: bool         # True = stage actually did real work
    latency_ms: float = 0.0
    meta: Dict[str, Any] = {}   # stage-specific extras (hit/miss, counts, scores…)


class RetrieveRequest(BaseModel):
    query: str
    namespace: str = "default"
    namespaces: Optional[List[str]] = None  # multi-namespace; overrides namespace when set
    top_k: int = 10
    top_n_rerank: int = 5
    use_graph: bool = True
    use_rerank: bool = True
    # --- pipeline visualization params (all default off for backward compat) ---
    user_id: Optional[str] = None
    use_cache: bool = False      # check semantic cache; return hit if found
    use_memory: bool = False     # load short+long memory by user_id
    use_rewrite: bool = False    # run query rewriter
    use_hyde: bool = False       # run HyDE generator

    @field_validator("query")
    @classmethod
    def query_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("query must not be empty or whitespace")
        return v


class RetrieveChunk(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    text_snippet: str
    score: float
    sequence_index: int
    stage: str  # "vector" | "graph" | "reranked"


class RetrieveResponse(BaseModel):
    query: str
    chunks: List[RetrieveChunk]
    graph_entities: List[Dict[str, Any]] = []
    graph_summary_texts: List[str] = []
    graph_seed_names: List[str] = []
    graph_seed_source: str = "empty"
    graph_seed_strategy: str = "none"
    retrieval_latency_ms: float = 0.0
    total_chunks_before_rerank: int = 0
    # --- stage metadata (new) ---
    stages: List[StageTimingInfo] = []
    cache_hit: bool = False
    cached_answer: Optional[str] = None
    memory_context_chars: int = 0
    rewritten_query: Optional[str] = None
    hyde_used: bool = False
    embed_latency_ms: float = 0.0
    vector_latency_ms: float = 0.0
    graph_latency_ms: float = 0.0
    rerank_latency_ms: float = 0.0
    knowledge_gap: bool = False
    top_rerank_score: float = 0.0


class MetricsSummaryResponse(BaseModel):
    query_volume_total: int = 0
    avg_retrieval_latency_ms: float = 0.0
    avg_answer_latency_ms: float = 0.0
    avg_total_latency_ms: float = 0.0
    error_rate: float = 0.0
    cache_hit_rate: float = 0.0
    document_count: int = 0
    chunk_count: int = 0
    pending_approvals: int = 0
    circuit_breakers: List[CircuitBreakerStatus] = []
    avg_grounding_score: float = 0.0
    knowledge_gaps_24h: int = 0
    rate_limit: Optional[RateLimitStats] = None
