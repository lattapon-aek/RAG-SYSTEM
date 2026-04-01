"""
Intelligence Service domain entities
"""
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class CandidateStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


@dataclass
class KnowledgeCandidate:
    id: str
    content: str
    source_request_id: str
    confidence_score: float          # 0.0 – 1.0
    status: CandidateStatus = CandidateStatus.PENDING
    target_namespace: str = "default"   # namespace to ingest into when approved
    source_type: str = "interaction"
    source_label: Optional[str] = None
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    source_summary: Optional[str] = None
    source_metadata: Dict[str, Any] = field(default_factory=dict)
    proposed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AuditLogEntry:
    id: str
    action: str                      # "approved" | "rejected" | "expired"
    candidate_id: str
    admin_user_id: Optional[str]
    timestamp: datetime
    notes: Optional[str] = None


@dataclass
class EvaluationResult:
    id: str
    request_id: str
    faithfulness: float
    answer_relevance: float
    context_precision: float
    context_recall: float
    evaluated_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EvaluationSummary:
    total_evaluated: int
    avg_faithfulness: float
    avg_answer_relevance: float
    avg_context_precision: float
    avg_context_recall: float
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None


@dataclass
class FeedbackRecord:
    id: str
    request_id: str
    user_id: Optional[str]
    feedback_score: float            # 0.0 – 1.0
    comment: Optional[str] = None
    category: str = 'general'       # general | wrong_answer | incomplete | off_topic | hallucination
    query_text: Optional[str] = None
    namespace: str = "default"
    source_type: str = "chat"
    source_id: Optional[str] = None
    created_at: Optional[datetime] = None


@dataclass
class QueryCluster:
    id: str
    label: str
    query_count: int
    avg_feedback_score: float
    sample_queries: List[str] = field(default_factory=list)
    knowledge_gap: bool = False
    created_at: Optional[datetime] = None


@dataclass
class InteractionRecord:
    request_id: str
    query_length: int
    answer_length: int
    retrieval_latency_ms: float
    answer_latency_ms: float
    total_latency_ms: float
    from_cache: bool = False
    confidence_score: float = 1.0
    feedback_score: Optional[float] = None
    created_at: Optional[datetime] = None
    query_text: str = ""
    answer_text: str = ""
