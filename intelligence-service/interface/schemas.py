from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class ApproveRejectRequest(BaseModel):
    admin_user_id: Optional[str] = None
    notes: Optional[str] = None
    content: Optional[str] = None  # override candidate content before ingestion
    target_namespace: Optional[str] = None  # override destination namespace


class CreateCandidateRequest(BaseModel):
    proposed_content: str
    confidence_score: float = Field(..., ge=0.0, le=1.0)
    source_request_id: str
    target_namespace: Optional[str] = None
    source_type: str = "manual"
    source_label: Optional[str] = None
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    source_summary: Optional[str] = None
    source_metadata: Dict[str, Any] = Field(default_factory=dict)


class FeedbackRequest(BaseModel):
    request_id: str
    feedback_score: float = Field(..., ge=0.0, le=1.0)
    user_id: Optional[str] = None
    comment: Optional[str] = None
    query_text: Optional[str] = None
    category: str = 'general'
    namespace: Optional[str] = None
    source_type: str = 'chat'
    source_id: Optional[str] = None


class EvaluationRunRequest(BaseModel):
    request_id: str
    query: str
    answer: str
    contexts: List[str] = Field(default_factory=list)


class CandidateResponse(BaseModel):
    id: str
    content: str
    proposed_content: str  # alias for dashboard compatibility
    source_request_id: str
    confidence_score: float
    status: str
    source_type: str = "interaction"
    source_label: Optional[str] = None
    source_url: Optional[str] = None
    source_title: Optional[str] = None
    source_summary: Optional[str] = None
    source_metadata: Dict[str, Any] = Field(default_factory=dict)
    proposed_at: Optional[datetime]
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime]
    decided_at: Optional[datetime]
    decided_by: Optional[str]
    target_namespace: str = "default"


class EvaluationResultResponse(BaseModel):
    id: str
    request_id: str
    faithfulness: float
    answer_relevance: float
    context_precision: float
    context_recall: float
    evaluated_at: Optional[datetime]


class EvaluationSummaryResponse(BaseModel):
    total_evaluated: int
    avg_faithfulness: float
    avg_answer_relevance: float
    avg_context_precision: float
    avg_context_recall: float


class FeedbackStatsResponse(BaseModel):
    avg_score: float
    recent_count: int


class AuditLogResponse(BaseModel):
    id: str
    action: str
    candidate_id: str
    admin_user_id: Optional[str]
    timestamp: datetime
    notes: Optional[str]
