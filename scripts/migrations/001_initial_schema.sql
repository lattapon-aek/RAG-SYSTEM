-- Migration 001: Initial Schema
-- Requirements: 1.4, 1.5, 8.2, 10.4, 11.5, 12.5, 17.2, 18.1, 24.2

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename    TEXT NOT NULL,
    source_url  TEXT,
    mime_type   TEXT NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    chunk_count INTEGER NOT NULL DEFAULT 0,
    source_hash TEXT,
    content_source TEXT NOT NULL DEFAULT 'upload',
    expires_at  TIMESTAMPTZ,
    freshness_score FLOAT NOT NULL DEFAULT 1.0
);

-- Chunks table
CREATE TABLE IF NOT EXISTS chunks (
    id              TEXT PRIMARY KEY,
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    sequence_index  INTEGER NOT NULL,
    text            TEXT NOT NULL,
    token_count     INTEGER NOT NULL,
    chunk_type      TEXT NOT NULL DEFAULT 'flat',
    parent_chunk_id TEXT REFERENCES chunks(id)
);

-- Interaction log
CREATE TABLE IF NOT EXISTS interaction_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      TEXT NOT NULL,
    query_text      TEXT NOT NULL,
    answer_text     TEXT NOT NULL,
    chunk_ids       TEXT[],
    confidence_score FLOAT,
    feedback_score  INTEGER,
    tool_calls      JSONB,
    rewritten_query TEXT,
    hyde_used       BOOLEAN NOT NULL DEFAULT FALSE,
    sub_queries     TEXT[],
    grounding_score FLOAT,
    rouge_l_score   FLOAT,
    answer_length_ratio FLOAT,
    token_type      TEXT NOT NULL DEFAULT 'client_billable',
    adaptive_strategy TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interaction_log_created ON interaction_log(created_at);
CREATE INDEX IF NOT EXISTS idx_interaction_log_request ON interaction_log(request_id);

-- Approval queue
CREATE TABLE IF NOT EXISTS approval_queue (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposed_content        TEXT NOT NULL,
    confidence_score        FLOAT NOT NULL,
    supporting_interaction_ids TEXT[],
    status                  TEXT NOT NULL DEFAULT 'pending',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMPTZ NOT NULL,
    decided_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_approval_queue_status ON approval_queue(status);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id   TEXT NOT NULL,
    action          TEXT NOT NULL,
    candidate_id    UUID NOT NULL REFERENCES approval_queue(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Metrics
CREATE TABLE IF NOT EXISTS metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name     TEXT NOT NULL,
    value           FLOAT NOT NULL,
    labels          JSONB,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON metrics(metric_name, recorded_at);

-- Evaluation results
CREATE TABLE IF NOT EXISTS evaluation_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          TEXT NOT NULL,
    faithfulness        FLOAT,
    answer_relevance    FLOAT,
    context_precision   FLOAT,
    context_recall      FLOAT,
    rouge_l_score       FLOAT,
    answer_length_ratio FLOAT,
    evaluated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eval_request ON evaluation_results(request_id);

-- Query feedback
CREATE TABLE IF NOT EXISTS query_feedback (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  TEXT NOT NULL,
    rating      SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_request ON query_feedback(request_id);

-- User memory (long-term)
CREATE TABLE IF NOT EXISTS user_memory (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'general',
    embedding   vector(1024),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id);

-- Chunk embedding cache
CREATE TABLE IF NOT EXISTS chunk_embedding_cache (
    sha256_hash  CHAR(64) NOT NULL,
    model_name   VARCHAR(255) NOT NULL,
    embedding    vector(1024) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sha256_hash, model_name)
);
