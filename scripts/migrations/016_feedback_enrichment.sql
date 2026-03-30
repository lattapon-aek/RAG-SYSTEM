-- Feedback enrichment for MCP agents and chat context
ALTER TABLE query_feedback
    ADD COLUMN IF NOT EXISTS query_text TEXT;

ALTER TABLE query_feedback
    ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'default';

ALTER TABLE query_feedback
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(64) NOT NULL DEFAULT 'chat';

ALTER TABLE query_feedback
    ADD COLUMN IF NOT EXISTS source_id TEXT;

ALTER TABLE query_feedback
    ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_feedback_namespace
    ON query_feedback(namespace);

CREATE INDEX IF NOT EXISTS idx_feedback_source_type
    ON query_feedback(source_type);

