import asyncio
import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Depends

from interface.schemas import (
    ApproveRejectRequest, FeedbackRequest, EvaluationRunRequest,
    CreateCandidateRequest, CandidateResponse, EvaluationResultResponse, EvaluationSummaryResponse,
    FeedbackStatsResponse, AuditLogResponse,
)
from interface.dependencies import (
    get_analyze_uc, get_approve_uc, get_reject_uc, get_expire_uc,
    get_evaluate_uc, get_eval_summary_uc, get_feedback_uc,
    get_audit_logger, get_feedback_repo, get_approval_repo,
    get_process_gaps_uc, get_pool, get_create_candidate_uc,
)
from domain.errors import CandidateNotFoundError, CandidateAlreadyDecidedError, EvaluationError

logger = logging.getLogger(__name__)

router = APIRouter()


def _candidate_response(c) -> CandidateResponse:
    return CandidateResponse(
        id=c.id,
        content=c.content,
        proposed_content=c.content,
        source_request_id=c.source_request_id,
        confidence_score=c.confidence_score,
        status=c.status.value if hasattr(c.status, "value") else str(c.status),
        source_type=getattr(c, "source_type", "interaction"),
        source_label=getattr(c, "source_label", None),
        source_url=getattr(c, "source_url", None),
        source_title=getattr(c, "source_title", None),
        source_summary=getattr(c, "source_summary", None),
        source_metadata=getattr(c, "source_metadata", {}) or {},
        proposed_at=c.proposed_at,
        created_at=getattr(c, "created_at", None) or c.proposed_at,
        expires_at=c.expires_at,
        decided_at=c.decided_at,
        decided_by=c.decided_by,
        target_namespace=c.target_namespace or "default",
    )


# ---------------------------------------------------------------------------
# Self-Learning
# ---------------------------------------------------------------------------

@router.get("/self-learning/candidates", response_model=List[CandidateResponse])
async def list_candidates(approval_repo=Depends(get_approval_repo)):
    candidates = await approval_repo.list_all()
    return [_candidate_response(c) for c in candidates]


@router.get("/self-learning/candidates/{candidate_id}", response_model=CandidateResponse)
async def get_candidate(candidate_id: str, approval_repo=Depends(get_approval_repo)):
    c = await approval_repo.get(candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Candidate {candidate_id} not found")
    return _candidate_response(c)


@router.post("/self-learning/candidates", response_model=CandidateResponse)
async def create_candidate(body: CreateCandidateRequest,
                           uc=Depends(get_create_candidate_uc)):
    candidate = await uc.execute(
        content=body.proposed_content,
        source_request_id=body.source_request_id,
        confidence_score=body.confidence_score,
        target_namespace=body.target_namespace or "default",
        source_type=body.source_type,
        source_label=body.source_label,
        source_url=body.source_url,
        source_title=body.source_title,
        source_summary=body.source_summary,
        source_metadata=body.source_metadata,
    )
    return _candidate_response(candidate)


@router.post("/self-learning/approve/{candidate_id}", response_model=CandidateResponse)
async def approve_candidate(candidate_id: str, body: ApproveRejectRequest,
                             uc=Depends(get_approve_uc)):
    try:
        c = await uc.execute(candidate_id, admin_user_id=body.admin_user_id,
                             content_override=body.content,
                             namespace_override=body.target_namespace)
        return _candidate_response(c)
    except CandidateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except CandidateAlreadyDecidedError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/self-learning/reject/{candidate_id}", response_model=CandidateResponse)
async def reject_candidate(candidate_id: str, body: ApproveRejectRequest,
                            uc=Depends(get_reject_uc)):
    try:
        c = await uc.execute(candidate_id, admin_user_id=body.admin_user_id, notes=body.notes)
        return _candidate_response(c)
    except CandidateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except CandidateAlreadyDecidedError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/self-learning/audit-log", response_model=List[AuditLogResponse])
async def get_audit_log(limit: int = 50, audit_logger=Depends(get_audit_logger)):
    entries = await audit_logger.list_recent(limit=limit)
    return [AuditLogResponse(
        id=e.id, action=e.action, candidate_id=e.candidate_id,
        admin_user_id=e.admin_user_id, timestamp=e.timestamp, notes=e.notes,
    ) for e in entries]


@router.post("/self-learning/trigger")
async def trigger_analysis(uc=Depends(get_analyze_uc)):
    """Manually trigger interaction analysis."""
    candidates = await uc.execute()
    return {"proposed": len(candidates)}


@router.post("/self-learning/process-gaps")
async def process_gaps(uc=Depends(get_process_gaps_uc)):
    """Manually trigger knowledge gap processing (promote high-occurrence gaps)."""
    promoted = await uc.execute()
    return {"promoted": promoted}


@router.get("/self-learning/gaps")
async def list_knowledge_gaps(status: str = "open", pool=Depends(get_pool)):
    """List knowledge gap log entries (for MCP and dashboard)."""
    allowed = {"open", "promoted", "ignored"}
    if status not in allowed:
        status = "open"
    rows = await pool.fetch(
        """SELECT id, query_text, namespace, top_score, occurrence_count,
                  status, logged_at, last_seen
           FROM knowledge_gap_log
           WHERE status = $1
           ORDER BY occurrence_count DESC, last_seen DESC
           LIMIT 100""",
        status,
    )
    return [
        {
            "id": str(r["id"]),
            "query_text": r["query_text"],
            "namespace": r["namespace"],
            "top_score": float(r["top_score"]),
            "occurrence_count": r["occurrence_count"],
            "status": r["status"],
            "logged_at": r["logged_at"].isoformat() if r["logged_at"] else None,
            "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
        }
        for r in rows
    ]


@router.post("/self-learning/gaps/{gap_id}/promote")
async def promote_gap(gap_id: str, uc=Depends(get_process_gaps_uc), pool=Depends(get_pool)):
    """Promote a single knowledge gap to the approval queue."""
    row = await pool.fetchrow(
        "SELECT id, query_text, namespace, top_score, occurrence_count FROM knowledge_gap_log WHERE id = $1",
        gap_id,
    )
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Gap not found")
    # Reuse ProcessKnowledgeGapsUseCase draft logic via internal call
    content = await uc._draft_content(
        query=row["query_text"],
        occurrence_count=row["occurrence_count"],
        top_score=float(row["top_score"]),
    )
    from domain.entities import KnowledgeCandidate, CandidateStatus
    from datetime import timedelta
    import uuid as _uuid
    candidate = KnowledgeCandidate(
        id=str(_uuid.uuid4()),
        content=content,
        source_request_id=str(row["id"]),
        confidence_score=float(row["top_score"]),
        status=CandidateStatus.PENDING,
        source_type="knowledge_gap",
        source_label="Knowledge gap",
        proposed_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    approval_repo = await get_approval_repo()
    await approval_repo.add(candidate)
    await pool.execute("UPDATE knowledge_gap_log SET status = 'promoted' WHERE id = $1", gap_id)
    return {"candidate_id": candidate.id, "status": "promoted"}


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

@router.post("/evaluation/run", response_model=EvaluationResultResponse)
async def run_evaluation(body: EvaluationRunRequest, uc=Depends(get_evaluate_uc)):
    try:
        result = await uc.execute(
            body.request_id, body.query, body.answer, body.contexts
        )
        return EvaluationResultResponse(
            id=str(result.id), request_id=str(result.request_id),
            faithfulness=result.faithfulness, answer_relevance=result.answer_relevance,
            context_precision=result.context_precision, context_recall=result.context_recall,
            evaluated_at=result.evaluated_at,
        )
    except EvaluationError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/evaluation/summary", response_model=EvaluationSummaryResponse)
async def evaluation_summary(uc=Depends(get_eval_summary_uc)):
    s = await uc.execute()
    return EvaluationSummaryResponse(
        total_evaluated=s.total_evaluated,
        avg_faithfulness=s.avg_faithfulness,
        avg_answer_relevance=s.avg_answer_relevance,
        avg_context_precision=s.avg_context_precision,
        avg_context_recall=s.avg_context_recall,
    )


@router.get("/evaluation/history", response_model=List[EvaluationResultResponse])
async def evaluation_history(limit: int = 50):
    from interface.dependencies import get_pool
    from infrastructure.postgres_repos import PostgresEvaluationRepo
    pool = await get_pool()
    results = await PostgresEvaluationRepo(pool).list_recent(limit=limit)
    return [EvaluationResultResponse(
        id=str(r.id), request_id=str(r.request_id),
        faithfulness=r.faithfulness, answer_relevance=r.answer_relevance,
        context_precision=r.context_precision, context_recall=r.context_recall,
        evaluated_at=r.evaluated_at,
    ) for r in results]


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

@router.post("/feedback/submit")
async def submit_feedback(body: FeedbackRequest, uc=Depends(get_feedback_uc)):
    record = await uc.execute(
        body.request_id, body.feedback_score,
        user_id=body.user_id, comment=body.comment,
        category=body.category,
        query_text=body.query_text,
        namespace=body.namespace,
        source_type=body.source_type,
        source_id=body.source_id,
    )
    return {"id": record.id, "status": "saved"}


@router.get("/feedback/stats", response_model=FeedbackStatsResponse)
async def feedback_stats(feedback_repo=Depends(get_feedback_repo)):
    avg = await feedback_repo.get_avg_score()
    recent = await feedback_repo.list_recent(limit=100)
    return FeedbackStatsResponse(avg_score=avg, recent_count=len(recent))


@router.get("/feedback/list")
async def feedback_list(limit: int = 100, pool=Depends(get_pool)):
    rows = await pool.fetch(
        """
        SELECT f.id, f.request_id, f.rating AS feedback_score, f.comment, f.category, f.created_at,
               f.namespace, f.source_type, f.source_id, f.user_id,
               COALESCE(f.query_text, i.query_text) AS query_text,
               i.answer_text
        FROM query_feedback f
        LEFT JOIN interaction_log i ON i.request_id = f.request_id
        ORDER BY f.created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [
        {
            "id": str(r["id"]),
            "request_id": str(r["request_id"]),
            "feedback_score": 1.0 if float(r["feedback_score"]) > 0 else 0.0,
            "comment": r["comment"],
            "category": r.get("category") or "general",
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "namespace": r.get("namespace") or "default",
            "source_type": r.get("source_type") or "chat",
            "source_id": r.get("source_id"),
            "user_id": r.get("user_id"),
            "query_text": r["query_text"],
            "answer_text": r["answer_text"],
        }
        for r in rows
    ]


@router.get("/feedback/analytics")
async def feedback_analytics(days: int = 14, feedback_repo=Depends(get_feedback_repo)):
    return await feedback_repo.get_analytics(days=days)
