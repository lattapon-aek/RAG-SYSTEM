"""
Self-Learning use cases:
- AnalyzeInteractions → ProposeKnowledge → Approve/Reject → Ingest
- Expiry check
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from domain.entities import KnowledgeCandidate, CandidateStatus, AuditLogEntry
from domain.errors import CandidateNotFoundError, CandidateAlreadyDecidedError
from application.ports.i_interaction_repository import IInteractionRepository
from application.ports.i_approval_queue_repository import IApprovalQueueRepository
from application.ports.i_audit_logger import IAuditLogger
from application.ports.i_ingestion_client import IIngestionServiceClient

logger = logging.getLogger(__name__)

_TERMINAL_STATES = {CandidateStatus.APPROVED, CandidateStatus.REJECTED, CandidateStatus.EXPIRED}
_DEFAULT_CANDIDATE_TTL_DAYS = 30
_LOW_CONFIDENCE_THRESHOLD = 0.5


class CreateKnowledgeCandidateUseCase:
    """Create a candidate from an external source and enqueue it for approval."""

    def __init__(self, approval_repo: IApprovalQueueRepository,
                 candidate_ttl_days: int = _DEFAULT_CANDIDATE_TTL_DAYS):
        self._approval = approval_repo
        self._ttl_days = candidate_ttl_days

    async def execute(
        self,
        *,
        content: str,
        source_request_id: str,
        confidence_score: float,
        target_namespace: str = "default",
        source_type: str = "manual",
        source_label: Optional[str] = None,
        source_url: Optional[str] = None,
        source_title: Optional[str] = None,
        source_summary: Optional[str] = None,
        source_metadata: Optional[dict] = None,
    ) -> KnowledgeCandidate:
        now = datetime.now(timezone.utc)
        candidate = KnowledgeCandidate(
            id=str(uuid.uuid4()),
            content=content,
            source_request_id=source_request_id,
            confidence_score=confidence_score,
            status=CandidateStatus.PENDING,
            target_namespace=target_namespace,
            source_type=source_type,
            source_label=source_label,
            source_url=source_url,
            source_title=source_title,
            source_summary=source_summary,
            source_metadata=source_metadata or {},
            proposed_at=now,
            created_at=now,
            expires_at=now + timedelta(days=self._ttl_days),
        )
        await self._approval.add(candidate)
        logger.info(
            "Created candidate %s source_type=%s confidence=%.2f",
            candidate.id, candidate.source_type, candidate.confidence_score,
        )
        return candidate


class AnalyzeInteractionsUseCase:
    """Scan recent interactions and propose knowledge candidates for low-confidence answers."""

    def __init__(self, interaction_repo: IInteractionRepository,
                 approval_repo: IApprovalQueueRepository,
                 candidate_ttl_days: int = _DEFAULT_CANDIDATE_TTL_DAYS):
        self._interactions = interaction_repo
        self._approval = approval_repo
        self._ttl_days = candidate_ttl_days

    async def execute(self, limit: int = 50) -> List[KnowledgeCandidate]:
        records = await self._interactions.get_low_confidence(
            threshold=_LOW_CONFIDENCE_THRESHOLD, limit=limit
        )
        candidates: List[KnowledgeCandidate] = []
        for record in records:
            q = record.query_text.strip() if record.query_text else f"request_id={record.request_id}"
            a = record.answer_text.strip() if record.answer_text else "(no answer recorded)"
            display = f"Q: {q}\n\nA: {a}"
            candidate = KnowledgeCandidate(
                id=str(uuid.uuid4()),
                content=display,
                source_request_id=record.request_id,
                confidence_score=record.confidence_score,
                status=CandidateStatus.PENDING,
                source_type="interaction",
                source_label="Low-confidence answer",
                proposed_at=datetime.now(timezone.utc),
                created_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=self._ttl_days),
                metadata={"query_length": record.query_length,
                          "total_latency_ms": record.total_latency_ms},
            )
            await self._approval.add(candidate)
            candidates.append(candidate)
            logger.info("Proposed candidate %s (confidence=%.2f)",
                        candidate.id, candidate.confidence_score)
        return candidates


class ApproveKnowledgeUseCase:
    def __init__(self, approval_repo: IApprovalQueueRepository,
                 audit_logger: IAuditLogger,
                 ingestion_client: IIngestionServiceClient):
        self._approval = approval_repo
        self._audit = audit_logger
        self._ingestion = ingestion_client

    async def execute(self, candidate_id: str,
                      admin_user_id: Optional[str] = None,
                      content_override: Optional[str] = None,
                      namespace_override: Optional[str] = None) -> KnowledgeCandidate:
        candidate = await self._approval.get(candidate_id)
        if not candidate:
            raise CandidateNotFoundError(f"Candidate {candidate_id} not found")
        if candidate.status in _TERMINAL_STATES:
            raise CandidateAlreadyDecidedError(
                f"Candidate {candidate_id} is already {candidate.status.value}"
            )

        await self._approval.update_status(
            candidate_id, CandidateStatus.APPROVED, decided_by=admin_user_id
        )
        await self._audit.log(AuditLogEntry(
            id=str(uuid.uuid4()),
            action="approved",
            candidate_id=candidate_id,
            admin_user_id=admin_user_id,
            timestamp=datetime.now(timezone.utc),
        ))

        # Auto-ingest approved content (use override if admin edited content/namespace)
        ingest_content = content_override.strip() if content_override and content_override.strip() else candidate.content
        ingest_namespace = (namespace_override.strip() if namespace_override and namespace_override.strip()
                            else candidate.target_namespace) or "default"
        try:
            ingest_source = candidate.source_type or "self_learning"
            await self._ingestion.ingest_text(
                ingest_content,
                {
                    "source": ingest_source,
                    "source_type": candidate.source_type,
                    "candidate_id": candidate_id,
                    "namespace": ingest_namespace,
                    "source_url": candidate.source_url,
                    "source_title": candidate.source_title,
                    "source_summary": candidate.source_summary,
                    "source_metadata": candidate.source_metadata,
                },
            )
        except Exception as exc:
            logger.error("Auto-ingest failed for candidate %s: %s", candidate_id, exc)

        updated = await self._approval.get(candidate_id)
        return updated if updated else candidate


class RejectKnowledgeUseCase:
    def __init__(self, approval_repo: IApprovalQueueRepository,
                 audit_logger: IAuditLogger):
        self._approval = approval_repo
        self._audit = audit_logger

    async def execute(self, candidate_id: str,
                      admin_user_id: Optional[str] = None,
                      notes: Optional[str] = None) -> KnowledgeCandidate:
        candidate = await self._approval.get(candidate_id)
        if not candidate:
            raise CandidateNotFoundError(f"Candidate {candidate_id} not found")
        if candidate.status in _TERMINAL_STATES:
            raise CandidateAlreadyDecidedError(
                f"Candidate {candidate_id} is already {candidate.status.value}"
            )

        await self._approval.update_status(
            candidate_id, CandidateStatus.REJECTED, decided_by=admin_user_id
        )
        await self._audit.log(AuditLogEntry(
            id=str(uuid.uuid4()),
            action="rejected",
            candidate_id=candidate_id,
            admin_user_id=admin_user_id,
            timestamp=datetime.now(timezone.utc),
            notes=notes,
        ))

        updated = await self._approval.get(candidate_id)
        return updated if updated else candidate


class ProcessKnowledgeGapsUseCase:
    """Scan open knowledge gaps and promote high-occurrence ones to approval_queue.

    Automatically drafts a placeholder candidate for manual approval.
    """

    def __init__(self, pool, approval_repo: IApprovalQueueRepository,
                 min_occurrences: int = 2,
                 candidate_ttl_days: int = _DEFAULT_CANDIDATE_TTL_DAYS,
                 llm=None):
        self._pool = pool
        self._approval = approval_repo
        self._min_occurrences = min_occurrences
        self._ttl_days = candidate_ttl_days
        self._llm = llm

    async def _draft_content(self, query: str, occurrence_count: int, top_score: float) -> str:
        """Return a placeholder candidate body for human review."""
        placeholder = (
            f"Q: {query}\n\n"
            f"[Knowledge gap — asked {occurrence_count}x, "
            f"best score {top_score:.2f}]"
        )
        if self._llm:
            try:
                drafted = await self._llm.draft_answer(query, [])
                if drafted:
                    return f"Q: {query}\n\nA: {drafted}"
            except Exception as exc:
                logger.warning("Auto-draft failed for gap %r: %s", query[:60], exc)
        return placeholder

    async def execute(self) -> int:
        rows = await self._pool.fetch(
            """SELECT id, query_text, namespace, top_score, occurrence_count
               FROM knowledge_gap_log
               WHERE status = 'open' AND occurrence_count >= $1
               ORDER BY occurrence_count DESC, top_score ASC
               LIMIT 20""",
            self._min_occurrences,
        )
        promoted = 0
        for row in rows:
            content = await self._draft_content(
                query=row["query_text"],
                occurrence_count=row["occurrence_count"],
                top_score=float(row["top_score"]),
            )
            candidate = KnowledgeCandidate(
                id=str(uuid.uuid4()),
                content=content,
                source_request_id=str(row["id"]),
                confidence_score=float(row["top_score"]),
                status=CandidateStatus.PENDING,
                target_namespace=row["namespace"] or "default",
                source_type="knowledge_gap",
                source_label="Knowledge gap",
                proposed_at=datetime.now(timezone.utc),
                created_at=datetime.now(timezone.utc),
                expires_at=datetime.now(timezone.utc) + timedelta(days=self._ttl_days),
            )
            await self._approval.add(candidate)
            await self._pool.execute(
                "UPDATE knowledge_gap_log SET status = 'promoted' WHERE id = $1",
                row["id"],
            )
            promoted += 1
            logger.info(
                "Promoted gap %s (%dx) to candidate %s",
                row["query_text"][:60], row["occurrence_count"], candidate.id,
            )
        return promoted


class ExpireCandidatesUseCase:
    """Mark pending candidates as expired when expires_at has passed."""

    def __init__(self, approval_repo: IApprovalQueueRepository,
                 audit_logger: IAuditLogger):
        self._approval = approval_repo
        self._audit = audit_logger

    async def execute(self) -> int:
        expired = await self._approval.list_expired()
        count = 0
        for candidate in expired:
            await self._approval.update_status(candidate.id, CandidateStatus.EXPIRED)
            await self._audit.log(AuditLogEntry(
                id=str(uuid.uuid4()),
                action="expired",
                candidate_id=candidate.id,
                admin_user_id=None,
                timestamp=datetime.now(timezone.utc),
            ))
            count += 1
        if count:
            logger.info("Expired %d candidates", count)
        return count
