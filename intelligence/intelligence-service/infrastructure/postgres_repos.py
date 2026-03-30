"""
PostgreSQL repositories for Intelligence Service
Uses asyncpg directly (same pattern as rag-service)
"""
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional

import asyncpg

from domain.entities import (
    KnowledgeCandidate, CandidateStatus, AuditLogEntry,
    EvaluationResult, EvaluationSummary, InteractionRecord,
)
from application.ports.i_interaction_repository import IInteractionRepository
from application.ports.i_approval_queue_repository import IApprovalQueueRepository
from application.ports.i_audit_logger import IAuditLogger
from application.ports.i_evaluation_repository import IEvaluationRepository

logger = logging.getLogger(__name__)


class PostgresInteractionRepo(IInteractionRepository):
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def list_recent(self, limit: int = 100) -> List[InteractionRecord]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM interaction_log ORDER BY created_at DESC LIMIT $1", limit
            )
        return [self._row_to_record(r) for r in rows]

    async def get_low_confidence(self, threshold: float, limit: int = 50) -> List[InteractionRecord]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM interaction_log WHERE confidence_score < $1 "
                "ORDER BY created_at DESC LIMIT $2", threshold, limit
            )
        return [self._row_to_record(r) for r in rows]

    async def save(self, record: InteractionRecord) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO interaction_log
                   (request_id, query_text, answer_text, confidence_score)
                   VALUES ($1,$2,$3,$4)""",
                record.request_id,
                getattr(record, "query_text", str(record.query_length)),
                getattr(record, "answer_text", str(record.answer_length)),
                record.confidence_score,
            )

    @staticmethod
    def _row_to_record(r) -> InteractionRecord:
        query_text = r.get("query_text") or ""
        answer_text = r.get("answer_text") or ""
        return InteractionRecord(
            request_id=r["request_id"],
            query_length=len(query_text),
            answer_length=len(answer_text),
            retrieval_latency_ms=0.0,
            generation_latency_ms=0.0,
            total_latency_ms=0.0,
            from_cache=False,
            confidence_score=float(r.get("confidence_score") or 1.0),
            feedback_score=r.get("feedback_score"),
            created_at=r.get("created_at"),
            query_text=query_text,
            answer_text=answer_text,
        )


class PostgresApprovalQueueRepo(IApprovalQueueRepository):
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def add(self, candidate: KnowledgeCandidate) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO approval_queue
                   (id, proposed_content, supporting_interaction_ids, confidence_score, status,
                    expires_at, target_namespace, source_type, source_label, source_url,
                    source_title, source_summary, source_metadata)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
                candidate.id, candidate.content,
                [candidate.source_request_id] if candidate.source_request_id else [],
                candidate.confidence_score, candidate.status.value,
                candidate.expires_at,
                candidate.target_namespace,
                candidate.source_type,
                candidate.source_label,
                candidate.source_url,
                candidate.source_title,
                candidate.source_summary,
                json.dumps(candidate.source_metadata or {}),
            )

    async def get(self, candidate_id: str) -> Optional[KnowledgeCandidate]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM approval_queue WHERE id = $1", candidate_id
            )
        return self._row_to_candidate(row) if row else None

    async def list_pending(self) -> List[KnowledgeCandidate]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at DESC"
            )
        return [self._row_to_candidate(r) for r in rows]

    async def list_all(self, limit: int = 200) -> List[KnowledgeCandidate]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM approval_queue ORDER BY created_at DESC LIMIT $1", limit
            )
        return [self._row_to_candidate(r) for r in rows]

    async def update_status(self, candidate_id: str, status: CandidateStatus,
                            decided_by: Optional[str] = None) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """UPDATE approval_queue SET status=$1, decided_at=$2
                   WHERE id=$3""",
                status.value, datetime.now(timezone.utc), candidate_id,
            )

    async def list_expired(self) -> List[KnowledgeCandidate]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM approval_queue WHERE status='pending' AND expires_at < $1",
                datetime.now(timezone.utc),
            )
        return [self._row_to_candidate(r) for r in rows]

    @staticmethod
    def _row_to_candidate(r) -> KnowledgeCandidate:
        interaction_ids = r.get("supporting_interaction_ids") or []
        return KnowledgeCandidate(
            id=str(r["id"]),
            content=r["proposed_content"],
            source_request_id=interaction_ids[0] if interaction_ids else "",
            confidence_score=float(r["confidence_score"]),
            status=CandidateStatus(r["status"]),
            target_namespace=r.get("target_namespace") or "default",
            source_type=r.get("source_type") or "interaction",
            source_label=r.get("source_label"),
            source_url=r.get("source_url"),
            source_title=r.get("source_title"),
            source_summary=r.get("source_summary"),
            source_metadata=(
                json.loads(r["source_metadata"]) if isinstance(r.get("source_metadata"), str)
                else (r.get("source_metadata") or {})
            ),
            proposed_at=r.get("created_at"),
            created_at=r.get("created_at"),
            expires_at=r.get("expires_at"),
            decided_at=r.get("decided_at"),
        )


class PostgresAuditLogger(IAuditLogger):
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def log(self, entry: AuditLogEntry) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO audit_log (id, action, candidate_id, admin_user_id, notes)
                   VALUES ($1,$2,$3,$4,$5)""",
                entry.id, entry.action, entry.candidate_id,
                entry.admin_user_id or "system", entry.notes,
            )

    async def list_recent(self, limit: int = 50) -> List[AuditLogEntry]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1", limit
            )
        return [
            AuditLogEntry(
                id=str(r["id"]), action=r["action"], candidate_id=str(r["candidate_id"]),
                admin_user_id=r.get("admin_user_id"),
                timestamp=r.get("created_at"),
                notes=r.get("notes"),
            )
            for r in rows
        ]


class PostgresEvaluationRepo(IEvaluationRepository):
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def save(self, result: EvaluationResult) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO evaluation_results
                   (id, request_id, faithfulness, answer_relevance,
                    context_precision, context_recall, evaluated_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)
                   ON CONFLICT (id) DO NOTHING""",
                result.id, result.request_id, result.faithfulness,
                result.answer_relevance, result.context_precision,
                result.context_recall,
                result.evaluated_at or datetime.now(timezone.utc),
            )

    async def list_recent(self, limit: int = 100) -> List[EvaluationResult]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM evaluation_results ORDER BY evaluated_at DESC LIMIT $1", limit
            )
        return [self._row_to_result(r) for r in rows]

    async def get_summary(self) -> EvaluationSummary:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """SELECT COUNT(*) as total,
                          AVG(faithfulness) as avg_f,
                          AVG(answer_relevance) as avg_ar,
                          AVG(context_precision) as avg_cp,
                          AVG(context_recall) as avg_cr
                   FROM evaluation_results"""
            )
        return EvaluationSummary(
            total_evaluated=row["total"] or 0,
            avg_faithfulness=float(row["avg_f"] or 0),
            avg_answer_relevance=float(row["avg_ar"] or 0),
            avg_context_precision=float(row["avg_cp"] or 0),
            avg_context_recall=float(row["avg_cr"] or 0),
        )

    @staticmethod
    def _row_to_result(r) -> EvaluationResult:
        return EvaluationResult(
            id=r["id"], request_id=r["request_id"],
            faithfulness=float(r["faithfulness"]),
            answer_relevance=float(r["answer_relevance"]),
            context_precision=float(r["context_precision"]),
            context_recall=float(r["context_recall"]),
            evaluated_at=r.get("evaluated_at"),
        )


class PostgresFeedbackRepo:
    """Stores and retrieves user feedback records."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def save(self, record) -> None:
        # schema: id, request_id, rating SMALLINT, comment, category, query_text,
        # namespace, source_type, source_id, user_id, created_at
        # feedback_score (0.0–1.0) mapped to rating: >=0.5 → 1 (positive), <0.5 → -1 (negative)
        score = getattr(record, "feedback_score", None)
        if score is None:
            score = 0.5
        rating = 1 if score >= 0.5 else -1
        category = getattr(record, "category", "general") or "general"
        namespace = getattr(record, "namespace", None) or "default"
        source_type = getattr(record, "source_type", None) or "chat"
        async with self._pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO query_feedback
                   (id, request_id, rating, comment, category, query_text,
                    namespace, source_type, source_id, user_id)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                   ON CONFLICT (id) DO NOTHING""",
                record.id, record.request_id, rating,
                getattr(record, "comment", None),
                category,
                getattr(record, "query_text", None),
                namespace,
                source_type,
                getattr(record, "source_id", None),
                getattr(record, "user_id", None),
            )

    async def list_recent(self, limit: int = 100):
        from domain.entities import FeedbackRecord
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM query_feedback ORDER BY created_at DESC LIMIT $1", limit
            )
        return [
            FeedbackRecord(
                id=str(r["id"]),
                request_id=r["request_id"],
                user_id=r.get("user_id"),
                feedback_score=1.0 if float(r["rating"]) > 0 else 0.0,
                comment=r.get("comment"),
                category=r.get("category") or "general",
                query_text=r.get("query_text"),
                namespace=r.get("namespace") or "default",
                source_type=r.get("source_type") or "chat",
                source_id=r.get("source_id"),
                created_at=r.get("created_at"),
            )
            for r in rows
        ]

    async def get_avg_score(self) -> float:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT AVG(rating) as avg FROM query_feedback")
        raw_avg = row["avg"]
        if raw_avg is None:
            return 0.0
        avg = float(raw_avg)
        return (avg + 1.0) / 2.0

    async def get_analytics(self, days: int = 14) -> dict:
        """Return feedback analytics: by namespace, category, and daily trend."""
        async with self._pool.acquire() as conn:
            # By namespace
            ns_rows = await conn.fetch(
                """SELECT COALESCE(qf.namespace, il.namespace, 'unknown') as namespace,
                          COUNT(*) as total,
                          SUM(CASE WHEN qf.rating = 1 THEN 1 ELSE 0 END) as good_count,
                          SUM(CASE WHEN qf.rating = -1 THEN 1 ELSE 0 END) as bad_count
                   FROM query_feedback qf
                   LEFT JOIN interaction_log il ON il.request_id = qf.request_id
                   WHERE qf.created_at >= NOW() - ($1 || ' days')::interval
                   GROUP BY COALESCE(qf.namespace, il.namespace, 'unknown')
                   ORDER BY bad_count DESC""",
                str(days),
            )
            # By category
            cat_rows = await conn.fetch(
                """SELECT category,
                          COUNT(*) as total,
                          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as good_count,
                          SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as bad_count
                   FROM query_feedback
                   WHERE created_at >= NOW() - ($1 || ' days')::interval
                   GROUP BY category
                   ORDER BY bad_count DESC""",
                str(days),
            )
            # Daily trend
            daily_rows = await conn.fetch(
                """SELECT DATE(created_at) as date,
                          COUNT(*) as total,
                          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as good_count,
                          SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as bad_count
                   FROM query_feedback
                   WHERE created_at >= NOW() - ($1 || ' days')::interval
                   GROUP BY DATE(created_at)
                   ORDER BY date ASC""",
                str(days),
            )
        return {
            "by_namespace": [
                {"namespace": r["namespace"], "total": r["total"],
                 "good_count": r["good_count"], "bad_count": r["bad_count"],
                 "bad_rate": round(r["bad_count"] / r["total"], 3) if r["total"] else 0}
                for r in ns_rows
            ],
            "by_category": [
                {"category": r["category"], "total": r["total"],
                 "good_count": r["good_count"], "bad_count": r["bad_count"],
                 "bad_rate": round(r["bad_count"] / r["total"], 3) if r["total"] else 0}
                for r in cat_rows
            ],
            "daily_trend": [
                {"date": str(r["date"]), "total": r["total"],
                 "good_count": r["good_count"], "bad_count": r["bad_count"],
                 "bad_rate": round(r["bad_count"] / r["total"], 3) if r["total"] else 0}
                for r in daily_rows
            ],
        }
