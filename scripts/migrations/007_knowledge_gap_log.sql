-- Migration 007: Add knowledge_gap_log table
-- Replaces KC fallback auto-fetch. When top retrieval score is below threshold,
-- the gap is logged here for later review/enrichment via the external agent flow.
CREATE TABLE IF NOT EXISTS knowledge_gap_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_text      TEXT        NOT NULL,
    namespace       TEXT        NOT NULL DEFAULT 'default',
    top_score       FLOAT       NOT NULL,
    threshold       FLOAT       NOT NULL,
    logged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_gap_log_namespace_logged_at
    ON knowledge_gap_log (namespace, logged_at DESC);
