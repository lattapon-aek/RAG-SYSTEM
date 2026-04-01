"""
Unit tests for Intelligence Service use cases.
Tests run without DB — all repos are mocked.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../intelligence-service"))

import pytest
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock
from typing import List, Optional

from domain.entities import (
    KnowledgeCandidate, CandidateStatus, AuditLogEntry,
    EvaluationResult, FeedbackRecord, InteractionRecord,
)
from domain.errors import CandidateNotFoundError, CandidateAlreadyDecidedError, EvaluationError
from application.self_learning_use_cases import (
    AnalyzeInteractionsUseCase, ApproveKnowledgeUseCase,
    RejectKnowledgeUseCase, ExpireCandidatesUseCase,
)
from application.evaluation_use_cases import (
    EvaluateAnswerUseCase, SampleQueryUseCase, GetEvaluationSummaryUseCase,
)
from application.feedback_use_cases import ProcessFeedbackUseCase


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_candidate(status=CandidateStatus.PENDING, confidence=0.3) -> KnowledgeCandidate:
    return KnowledgeCandidate(
        id="cand-1",
        content="test content",
        source_request_id="req-1",
        confidence_score=confidence,
        status=status,
        proposed_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )


def make_interaction(confidence=0.3) -> InteractionRecord:
    return InteractionRecord(
        request_id="req-1",
        query_length=50,
        answer_length=100,
        retrieval_latency_ms=10.0,
        answer_latency_ms=20.0,
        total_latency_ms=30.0,
        confidence_score=confidence,
    )


def make_eval_result() -> EvaluationResult:
    return EvaluationResult(
        id="eval-1", request_id="req-1",
        faithfulness=0.9, answer_relevance=0.8,
        context_precision=0.7, context_recall=0.6,
        evaluated_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# AnalyzeInteractionsUseCase
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_analyze_proposes_candidates_for_low_confidence():
    interaction_repo = AsyncMock()
    approval_repo = AsyncMock()
    interaction_repo.get_low_confidence.return_value = [make_interaction(confidence=0.3)]
    approval_repo.add.return_value = None

    uc = AnalyzeInteractionsUseCase(interaction_repo, approval_repo)
    candidates = await uc.execute()

    assert len(candidates) == 1
    assert candidates[0].confidence_score == 0.3
    assert candidates[0].status == CandidateStatus.PENDING
    approval_repo.add.assert_called_once()


@pytest.mark.asyncio
async def test_analyze_returns_empty_when_no_low_confidence():
    interaction_repo = AsyncMock()
    approval_repo = AsyncMock()
    interaction_repo.get_low_confidence.return_value = []

    uc = AnalyzeInteractionsUseCase(interaction_repo, approval_repo)
    candidates = await uc.execute()

    assert candidates == []
    approval_repo.add.assert_not_called()


# ---------------------------------------------------------------------------
# ApproveKnowledgeUseCase — terminal state machine
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_approve_pending_candidate_succeeds():
    approval_repo = AsyncMock()
    audit_logger = AsyncMock()
    ingestion_client = AsyncMock()
    approval_repo.get.side_effect = [
        make_candidate(status=CandidateStatus.PENDING),
        make_candidate(status=CandidateStatus.APPROVED),
    ]

    uc = ApproveKnowledgeUseCase(approval_repo, audit_logger, ingestion_client)
    result = await uc.execute("cand-1", admin_user_id="admin")

    assert result.status == CandidateStatus.APPROVED
    approval_repo.update_status.assert_called_once()
    audit_logger.log.assert_called_once()
    ingestion_client.ingest_text.assert_called_once()


@pytest.mark.asyncio
async def test_approve_already_approved_raises():
    approval_repo = AsyncMock()
    audit_logger = AsyncMock()
    ingestion_client = AsyncMock()
    approval_repo.get.return_value = make_candidate(status=CandidateStatus.APPROVED)

    uc = ApproveKnowledgeUseCase(approval_repo, audit_logger, ingestion_client)
    with pytest.raises(CandidateAlreadyDecidedError):
        await uc.execute("cand-1")


@pytest.mark.asyncio
async def test_approve_rejected_candidate_raises():
    approval_repo = AsyncMock()
    audit_logger = AsyncMock()
    ingestion_client = AsyncMock()
    approval_repo.get.return_value = make_candidate(status=CandidateStatus.REJECTED)

    uc = ApproveKnowledgeUseCase(approval_repo, audit_logger, ingestion_client)
    with pytest.raises(CandidateAlreadyDecidedError):
        await uc.execute("cand-1")


@pytest.mark.asyncio
async def test_approve_expired_candidate_raises():
    approval_repo = AsyncMock()
    audit_logger = AsyncMock()
    ingestion_client = AsyncMock()
    approval_repo.get.return_value = make_candidate(status=CandidateStatus.EXPIRED)

    uc = ApproveKnowledgeUseCase(approval_repo, audit_logger, ingestion_client)
    with pytest.raises(CandidateAlreadyDecidedError):
        await uc.execute("cand-1")


@pytest.mark.asyncio
async def test_approve_not_found_raises():
    approval_repo = AsyncMock()
    approval_repo.get.return_value = None

    uc = ApproveKnowledgeUseCase(approval_repo, AsyncMock(), AsyncMock())
    with pytest.raises(CandidateNotFoundError):
        await uc.execute("missing-id")


@pytest.mark.asyncio
async def test_approve_ingestion_failure_does_not_raise():
    """Ingestion failure should be logged but not propagate."""
    approval_repo = AsyncMock()
    audit_logger = AsyncMock()
    ingestion_client = AsyncMock()
    ingestion_client.ingest_text.side_effect = Exception("network error")
    approval_repo.get.side_effect = [
        make_candidate(status=CandidateStatus.PENDING),
        make_candidate(status=CandidateStatus.APPROVED),
    ]

    uc = ApproveKnowledgeUseCase(approval_repo, audit_logger, ingestion_client)
    result = await uc.execute("cand-1")  # should not raise
    assert result.status == CandidateStatus.APPROVED


# ---------------------------------------------------------------------------
# RejectKnowledgeUseCase — terminal state machine
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reject_pending_candidate_succeeds():
    approval_repo = AsyncMock()
    audit_logger = AsyncMock()
    approval_repo.get.side_effect = [
        make_candidate(status=CandidateStatus.PENDING),
        make_candidate(status=CandidateStatus.REJECTED),
    ]

    uc = RejectKnowledgeUseCase(approval_repo, audit_logger)
    result = await uc.execute("cand-1", notes="not relevant")

    assert result.status == CandidateStatus.REJECTED
    audit_logger.log.assert_called_once()


@pytest.mark.asyncio
async def test_reject_already_decided_raises():
    for terminal in [CandidateStatus.APPROVED, CandidateStatus.REJECTED, CandidateStatus.EXPIRED]:
        approval_repo = AsyncMock()
        approval_repo.get.return_value = make_candidate(status=terminal)
        uc = RejectKnowledgeUseCase(approval_repo, AsyncMock())
        with pytest.raises(CandidateAlreadyDecidedError):
            await uc.execute("cand-1")


# ---------------------------------------------------------------------------
# ExpireCandidatesUseCase
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_expire_marks_expired_candidates():
    approval_repo = AsyncMock()
    audit_logger = AsyncMock()
    expired = [make_candidate(), make_candidate()]
    expired[1].id = "cand-2"
    approval_repo.list_expired.return_value = expired

    uc = ExpireCandidatesUseCase(approval_repo, audit_logger)
    count = await uc.execute()

    assert count == 2
    assert approval_repo.update_status.call_count == 2
    assert audit_logger.log.call_count == 2


@pytest.mark.asyncio
async def test_expire_returns_zero_when_nothing_expired():
    approval_repo = AsyncMock()
    approval_repo.list_expired.return_value = []

    uc = ExpireCandidatesUseCase(approval_repo, AsyncMock())
    count = await uc.execute()
    assert count == 0


# ---------------------------------------------------------------------------
# Confidence score range property
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_proposed_candidate_confidence_in_range():
    """Property 8: confidence_score must be in [0.0, 1.0]"""
    interaction_repo = AsyncMock()
    approval_repo = AsyncMock()
    approval_repo.add.return_value = None

    for confidence in [0.0, 0.1, 0.49, 0.5]:
        interaction_repo.get_low_confidence.return_value = [make_interaction(confidence=confidence)]
        uc = AnalyzeInteractionsUseCase(interaction_repo, approval_repo)
        candidates = await uc.execute()
        for c in candidates:
            assert 0.0 <= c.confidence_score <= 1.0


# ---------------------------------------------------------------------------
# EvaluateAnswerUseCase
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_evaluate_saves_result():
    evaluator = AsyncMock()
    eval_repo = AsyncMock()
    evaluator.evaluate.return_value = make_eval_result()

    uc = EvaluateAnswerUseCase(evaluator, eval_repo)
    result = await uc.execute("req-1", "query", "answer", ["ctx1"])

    assert result.faithfulness == 0.9
    eval_repo.save.assert_called_once()


@pytest.mark.asyncio
async def test_evaluate_raises_on_evaluator_error():
    evaluator = AsyncMock()
    eval_repo = AsyncMock()
    evaluator.evaluate.side_effect = Exception("ragas failed")

    uc = EvaluateAnswerUseCase(evaluator, eval_repo)
    with pytest.raises(EvaluationError):
        await uc.execute("req-1", "query", "answer", [])


# ---------------------------------------------------------------------------
# SampleQueryUseCase — sampling rate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sample_rate_zero_never_evaluates():
    evaluate_uc = AsyncMock()
    uc = SampleQueryUseCase(evaluate_uc, sample_rate=0.0)
    result = await uc.execute("req-1", "q", "a", [])
    assert result is None
    evaluate_uc.execute.assert_not_called()


@pytest.mark.asyncio
async def test_sample_rate_one_always_evaluates():
    evaluate_uc = AsyncMock()
    evaluate_uc.execute.return_value = make_eval_result()
    uc = SampleQueryUseCase(evaluate_uc, sample_rate=1.0)
    result = await uc.execute("req-1", "q", "a", [])
    assert result is not None
    evaluate_uc.execute.assert_called_once()


# ---------------------------------------------------------------------------
# ProcessFeedbackUseCase
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_feedback_saved_and_returned():
    feedback_repo = AsyncMock()
    interaction_repo = AsyncMock()
    approval_repo = AsyncMock()

    uc = ProcessFeedbackUseCase(feedback_repo, interaction_repo, approval_repo)
    record = await uc.execute(
        "req-1",
        0.8,
        user_id="user-1",
        comment="good answer",
        category="general",
        query_text="What is RAG?",
        namespace="abap",
        source_type="chat",
        source_id="msg-1",
    )

    assert record.feedback_score == 0.8
    assert record.request_id == "req-1"
    assert record.namespace == "abap"
    assert record.source_type == "chat"
    assert record.source_id == "msg-1"
    feedback_repo.save.assert_called_once()
    saved = feedback_repo.save.call_args.args[0]
    assert saved.namespace == "abap"
    assert saved.source_type == "chat"
    assert saved.query_text == "What is RAG?"


@pytest.mark.asyncio
async def test_low_feedback_enqueues_candidate():
    feedback_repo = AsyncMock()
    interaction_repo = AsyncMock()
    approval_repo = AsyncMock()

    uc = ProcessFeedbackUseCase(feedback_repo, interaction_repo, approval_repo,
                                 low_confidence_threshold=0.5)
    await uc.execute("req-1", 0.2, namespace="finance", source_type="mcp_agent")  # below threshold

    approval_repo.add.assert_called_once()
    candidate = approval_repo.add.call_args.args[0]
    assert candidate.target_namespace == "finance"
    assert candidate.metadata["feedback_source_type"] == "mcp_agent"


@pytest.mark.asyncio
async def test_high_feedback_does_not_enqueue():
    feedback_repo = AsyncMock()
    interaction_repo = AsyncMock()
    approval_repo = AsyncMock()

    uc = ProcessFeedbackUseCase(feedback_repo, interaction_repo, approval_repo,
                                 low_confidence_threshold=0.5)
    await uc.execute("req-1", 0.9)  # above threshold

    approval_repo.add.assert_not_called()
