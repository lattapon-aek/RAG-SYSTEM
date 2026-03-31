"""
Feedback Analysis and Query Clustering use cases:
- ProcessFeedbackUseCase
- ClusterQueriesUseCase
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional

from domain.entities import (
    FeedbackRecord, QueryCluster, KnowledgeCandidate, CandidateStatus, InteractionRecord,
)
from application.ports.i_feedback_repository import IFeedbackRepository
from application.ports.i_interaction_repository import IInteractionRepository
from application.ports.i_approval_queue_repository import IApprovalQueueRepository

logger = logging.getLogger(__name__)

_LOW_CONFIDENCE_THRESHOLD = 0.5
_DEFAULT_CANDIDATE_TTL_DAYS = 30


class ProcessFeedbackUseCase:
    """Store user feedback and auto-enqueue low-confidence interactions for self-learning."""

    def __init__(self, feedback_repo: IFeedbackRepository,
                 interaction_repo: IInteractionRepository,
                 approval_repo: IApprovalQueueRepository,
                 low_confidence_threshold: float = _LOW_CONFIDENCE_THRESHOLD,
                 redis_client=None):
        self._feedback = feedback_repo
        self._interactions = interaction_repo
        self._approval = approval_repo
        self._threshold = low_confidence_threshold
        self._redis = redis_client

    async def execute(self, request_id: str, feedback_score: float,
                      user_id: Optional[str] = None,
                      comment: Optional[str] = None,
                      category: str = 'general',
                      query_text: Optional[str] = None,
                      namespace: Optional[str] = None,
                      source_type: str = 'chat',
                      source_id: Optional[str] = None) -> FeedbackRecord:
        record = FeedbackRecord(
            id=str(uuid.uuid4()),
            request_id=request_id,
            user_id=user_id,
            feedback_score=feedback_score,
            comment=comment,
            category=category,
            query_text=query_text,
            namespace=(namespace or "default").strip() or "default",
            source_type=(source_type or "chat").strip() or "chat",
            source_id=source_id,
            created_at=datetime.now(timezone.utc),
        )
        await self._feedback.save(record)
        logger.info("Feedback saved request_id=%s score=%.2f category=%s", request_id, feedback_score, category)

        # Auto-enqueue low-feedback interactions for self-learning
        if feedback_score < self._threshold:
            await self._maybe_enqueue_candidate(
                request_id=request_id,
                feedback_score=feedback_score,
                namespace=record.namespace,
                source_type=record.source_type,
                source_id=record.source_id,
                user_id=record.user_id,
                category=record.category,
                comment=record.comment,
                query_text=record.query_text,
            )

        # Update Redis chunk feedback scores
        await self._update_chunk_feedback(request_id, feedback_score)

        return record

    async def _update_chunk_feedback(self, request_id: str, feedback_score: float) -> None:
        """Update per-chunk feedback scores in Redis for retrieval boost."""
        if not self._redis:
            return
        try:
            import json as _json
            key = f"rag:req_chunks:{request_id}"
            raw = await self._redis.get(key)
            if not raw:
                return
            chunk_ids = _json.loads(raw)
            field = "good" if feedback_score >= 0.5 else "bad"
            for chunk_id in chunk_ids:
                await self._redis.hincrby(f"rag:chunk_fb:{chunk_id}", field, 1)
                # Set TTL 30 days on chunk feedback key
                await self._redis.expire(f"rag:chunk_fb:{chunk_id}", 60 * 60 * 24 * 30)
            logger.info("Updated chunk feedback for %d chunks from request_id=%s", len(chunk_ids), request_id)
        except Exception as exc:
            logger.warning("Failed to update chunk feedback in Redis: %s", exc)

    async def _maybe_enqueue_candidate(
        self,
        request_id: str,
        feedback_score: float,
        namespace: str = "default",
        source_type: str = "chat",
        source_id: Optional[str] = None,
        user_id: Optional[str] = None,
        category: str = "general",
        comment: Optional[str] = None,
        query_text: Optional[str] = None,
    ) -> None:
        from datetime import timedelta
        # Fetch actual query/answer text from interaction log
        records = await self._interactions.list_recent(limit=200)
        interaction = next((r for r in records if r.request_id == request_id), None)
        if interaction and interaction.query_text:
            q = interaction.query_text.strip()
            a = interaction.answer_text.strip() if interaction.answer_text else "(no answer recorded)"
            content = f"Q: {q}\n\nA: {a}"
        else:
            content = f"Low-feedback interaction: request_id={request_id}"

        candidate = KnowledgeCandidate(
            id=str(uuid.uuid4()),
            content=content,
            source_request_id=request_id,
            confidence_score=feedback_score,
            status=CandidateStatus.PENDING,
            source_type="feedback",
            source_label="Low-feedback interaction",
            proposed_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(days=_DEFAULT_CANDIDATE_TTL_DAYS),
            target_namespace=(namespace or "default").strip() or "default",
            metadata={
                "trigger": "low_feedback",
                "feedback_namespace": namespace,
                "feedback_source_type": source_type,
                "feedback_source_id": source_id,
                "feedback_user_id": user_id,
                "feedback_category": category,
                "feedback_comment": comment,
                "feedback_query_text": query_text,
            },
        )
        try:
            await self._approval.add(candidate)
            logger.info("Auto-enqueued candidate for low-feedback request_id=%s", request_id)
        except Exception as exc:
            logger.warning("Failed to enqueue candidate: %s", exc)


class ClusterQueriesUseCase:
    """
    Cluster recent low-feedback queries to identify knowledge gaps.
    Uses simple keyword grouping as a lightweight fallback when hdbscan unavailable.
    """

    def __init__(self, interaction_repo: IInteractionRepository,
                 approval_repo: IApprovalQueueRepository,
                 min_cluster_size: int = 5):
        self._interactions = interaction_repo
        self._approval = approval_repo
        self._min_cluster_size = min_cluster_size

    async def execute(self, limit: int = 200) -> List[QueryCluster]:
        records = await self._interactions.get_low_confidence(
            threshold=_LOW_CONFIDENCE_THRESHOLD, limit=limit
        )
        if not records:
            return []

        clusters = self._simple_cluster(records)
        gap_clusters = [c for c in clusters if c.knowledge_gap]

        for cluster in gap_clusters:
            await self._create_gap_candidate(cluster)

        return clusters

    def _simple_cluster(self, records: List[InteractionRecord]) -> List[QueryCluster]:
        """Group by query_length bucket as a simple proxy for clustering."""
        buckets: dict = {}
        for r in records:
            bucket = (r.query_length // 50) * 50  # 0-49, 50-99, ...
            buckets.setdefault(bucket, []).append(r)

        clusters = []
        for bucket, items in buckets.items():
            avg_score = sum(i.confidence_score for i in items) / len(items)
            cluster = QueryCluster(
                id=str(uuid.uuid4()),
                label=f"query_length_{bucket}_{bucket+49}",
                query_count=len(items),
                avg_feedback_score=avg_score,
                sample_queries=[f"request:{r.request_id}" for r in items[:3]],
                knowledge_gap=len(items) >= self._min_cluster_size and avg_score < 0.4,
                created_at=datetime.now(timezone.utc),
            )
            clusters.append(cluster)
        return clusters

    async def _create_gap_candidate(self, cluster: QueryCluster) -> None:
        from datetime import timedelta
        candidate = KnowledgeCandidate(
            id=str(uuid.uuid4()),
            content=f"Knowledge gap cluster: {cluster.label} ({cluster.query_count} queries)",
            source_request_id=cluster.id,
            confidence_score=cluster.avg_feedback_score,
            status=CandidateStatus.PENDING,
            source_type="feedback_cluster",
            source_label="Knowledge gap cluster",
            proposed_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + timedelta(days=_DEFAULT_CANDIDATE_TTL_DAYS),
            metadata={"trigger": "knowledge_gap", "cluster_label": cluster.label,
                      "query_count": cluster.query_count},
        )
        try:
            await self._approval.add(candidate)
            logger.info("Created gap candidate for cluster %s", cluster.label)
        except Exception as exc:
            logger.warning("Failed to create gap candidate: %s", exc)
