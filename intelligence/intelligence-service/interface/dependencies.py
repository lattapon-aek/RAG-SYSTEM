"""
Dependency injection for Intelligence Service.
All use cases are wired here from env-configured infrastructure.
"""
import os
import asyncpg
from functools import lru_cache

from infrastructure.postgres_repos import (
    PostgresInteractionRepo, PostgresApprovalQueueRepo,
    PostgresAuditLogger, PostgresEvaluationRepo, PostgresFeedbackRepo,
)
from infrastructure.ingestion_client import IngestionServiceHttpClient
from infrastructure.ragas_adapter import RAGASAdapter
from infrastructure.llm_client import OllamaLLMClient

from application.self_learning_use_cases import (
    AnalyzeInteractionsUseCase, ApproveKnowledgeUseCase,
    RejectKnowledgeUseCase, ExpireCandidatesUseCase,
    ProcessKnowledgeGapsUseCase, CreateKnowledgeCandidateUseCase,
)
from application.evaluation_use_cases import (
    EvaluateAnswerUseCase, SampleQueryUseCase, GetEvaluationSummaryUseCase,
)
from application.feedback_use_cases import ProcessFeedbackUseCase, ClusterQueriesUseCase

_pool: asyncpg.Pool = None


async def _bootstrap_approval_queue_schema(pool: asyncpg.Pool) -> None:
    """Keep approval_queue backward-compatible while adding source metadata."""
    async with pool.acquire() as conn:
        await conn.execute(
            """ALTER TABLE approval_queue
                   ADD COLUMN IF NOT EXISTS source_type VARCHAR(64) NOT NULL DEFAULT 'interaction'"""
        )
        await conn.execute(
            """ALTER TABLE approval_queue
                   ADD COLUMN IF NOT EXISTS source_label VARCHAR(255)"""
        )
        await conn.execute(
            """ALTER TABLE approval_queue
                   ADD COLUMN IF NOT EXISTS source_url TEXT"""
        )
        await conn.execute(
            """ALTER TABLE approval_queue
                   ADD COLUMN IF NOT EXISTS source_title TEXT"""
        )
        await conn.execute(
            """ALTER TABLE approval_queue
                   ADD COLUMN IF NOT EXISTS source_summary TEXT"""
        )
        await conn.execute(
            """ALTER TABLE approval_queue
                   ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb"""
        )
        await conn.execute(
            """CREATE INDEX IF NOT EXISTS idx_approval_queue_source_type
                   ON approval_queue(source_type)"""
        )
        await conn.execute(
            """ALTER TABLE query_feedback
                   ADD COLUMN IF NOT EXISTS query_text TEXT"""
        )
        await conn.execute(
            """ALTER TABLE query_feedback
                   ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'default'"""
        )
        await conn.execute(
            """ALTER TABLE query_feedback
                   ADD COLUMN IF NOT EXISTS source_type VARCHAR(64) NOT NULL DEFAULT 'chat'"""
        )
        await conn.execute(
            """ALTER TABLE query_feedback
                   ADD COLUMN IF NOT EXISTS source_id TEXT"""
        )
        await conn.execute(
            """ALTER TABLE query_feedback
                   ADD COLUMN IF NOT EXISTS user_id TEXT"""
        )
        await conn.execute(
            """CREATE INDEX IF NOT EXISTS idx_feedback_namespace
                   ON query_feedback(namespace)"""
        )
        await conn.execute(
            """CREATE INDEX IF NOT EXISTS idx_feedback_source_type
                   ON query_feedback(source_type)"""
        )


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=os.environ["POSTGRES_URL"], min_size=1, max_size=5
        )
        await _bootstrap_approval_queue_schema(_pool)
    return _pool


async def get_analyze_uc() -> AnalyzeInteractionsUseCase:
    pool = await get_pool()
    return AnalyzeInteractionsUseCase(
        interaction_repo=PostgresInteractionRepo(pool),
        approval_repo=PostgresApprovalQueueRepo(pool),
        candidate_ttl_days=int(os.getenv("CANDIDATE_EXPIRY_DAYS", "30")),
    )


async def get_approve_uc() -> ApproveKnowledgeUseCase:
    pool = await get_pool()
    return ApproveKnowledgeUseCase(
        approval_repo=PostgresApprovalQueueRepo(pool),
        audit_logger=PostgresAuditLogger(pool),
        ingestion_client=IngestionServiceHttpClient(
            os.getenv("INGESTION_SERVICE_URL", "http://ingestion-service:8001")
        ),
    )


async def get_reject_uc() -> RejectKnowledgeUseCase:
    pool = await get_pool()
    return RejectKnowledgeUseCase(
        approval_repo=PostgresApprovalQueueRepo(pool),
        audit_logger=PostgresAuditLogger(pool),
    )


async def get_expire_uc() -> ExpireCandidatesUseCase:
    pool = await get_pool()
    return ExpireCandidatesUseCase(
        approval_repo=PostgresApprovalQueueRepo(pool),
        audit_logger=PostgresAuditLogger(pool),
    )


async def get_evaluate_uc() -> EvaluateAnswerUseCase:
    pool = await get_pool()
    return EvaluateAnswerUseCase(
        evaluator=RAGASAdapter(),
        eval_repo=PostgresEvaluationRepo(pool),
    )


async def get_sample_uc() -> SampleQueryUseCase:
    evaluate_uc = await get_evaluate_uc()
    return SampleQueryUseCase(
        evaluate_use_case=evaluate_uc,
        sample_rate=float(os.getenv("EVALUATION_SAMPLE_RATE", "0.10")),
    )


async def get_eval_summary_uc() -> GetEvaluationSummaryUseCase:
    pool = await get_pool()
    return GetEvaluationSummaryUseCase(eval_repo=PostgresEvaluationRepo(pool))


async def get_feedback_uc() -> ProcessFeedbackUseCase:
    pool = await get_pool()
    redis_client = None
    try:
        import redis.asyncio as aioredis
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        redis_client = aioredis.from_url(redis_url, decode_responses=True)
    except Exception:
        pass
    return ProcessFeedbackUseCase(
        feedback_repo=PostgresFeedbackRepo(pool),
        interaction_repo=PostgresInteractionRepo(pool),
        approval_repo=PostgresApprovalQueueRepo(pool),
        redis_client=redis_client,
    )


async def get_cluster_uc() -> ClusterQueriesUseCase:
    pool = await get_pool()
    return ClusterQueriesUseCase(
        interaction_repo=PostgresInteractionRepo(pool),
        approval_repo=PostgresApprovalQueueRepo(pool),
        min_cluster_size=int(os.getenv("CLUSTERING_MIN_CLUSTER_SIZE", "5")),
    )


async def get_process_gaps_uc() -> ProcessKnowledgeGapsUseCase:
    pool = await get_pool()
    return ProcessKnowledgeGapsUseCase(
        pool=pool,
        approval_repo=PostgresApprovalQueueRepo(pool),
        min_occurrences=int(os.getenv("GAP_MIN_OCCURRENCES", "2")),
        candidate_ttl_days=int(os.getenv("CANDIDATE_EXPIRY_DAYS", "30")),
        llm=OllamaLLMClient(),
    )


async def get_create_candidate_uc() -> CreateKnowledgeCandidateUseCase:
    pool = await get_pool()
    return CreateKnowledgeCandidateUseCase(
        approval_repo=PostgresApprovalQueueRepo(pool),
        candidate_ttl_days=int(os.getenv("CANDIDATE_EXPIRY_DAYS", "30")),
    )


async def get_audit_logger():
    pool = await get_pool()
    return PostgresAuditLogger(pool)


async def get_feedback_repo():
    pool = await get_pool()
    return PostgresFeedbackRepo(pool)


async def get_approval_repo():
    pool = await get_pool()
    return PostgresApprovalQueueRepo(pool)
