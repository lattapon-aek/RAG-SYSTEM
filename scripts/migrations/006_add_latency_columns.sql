-- Migration 006: Add latency and cache tracking to interaction_log
ALTER TABLE interaction_log
    ADD COLUMN IF NOT EXISTS retrieval_latency_ms FLOAT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS generation_latency_ms FLOAT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS total_latency_ms FLOAT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS from_cache BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_interaction_log_latency
    ON interaction_log (total_latency_ms)
    WHERE total_latency_ms IS NOT NULL;
