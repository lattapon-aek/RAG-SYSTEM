-- Migration 014: Add source metadata to approval_queue
-- Keeps the shared approval queue backward-compatible while making source provenance explicit.

ALTER TABLE approval_queue
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(64) NOT NULL DEFAULT 'interaction';

ALTER TABLE approval_queue
    ADD COLUMN IF NOT EXISTS source_label VARCHAR(255);

ALTER TABLE approval_queue
    ADD COLUMN IF NOT EXISTS source_url TEXT;

ALTER TABLE approval_queue
    ADD COLUMN IF NOT EXISTS source_title TEXT;

ALTER TABLE approval_queue
    ADD COLUMN IF NOT EXISTS source_summary TEXT;

ALTER TABLE approval_queue
    ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_approval_queue_source_type
    ON approval_queue(source_type);
