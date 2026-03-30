-- Add category column to query_feedback
ALTER TABLE query_feedback
    ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'general';

-- Chunk tracking table (for feedback boost via Redis — this table is for analytics only)
CREATE TABLE IF NOT EXISTS feedback_chunk_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  TEXT NOT NULL,
    chunk_id    TEXT NOT NULL,
    namespace   TEXT NOT NULL DEFAULT 'default',
    rerank_score FLOAT NOT NULL DEFAULT 0.0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fbl_request_id ON feedback_chunk_log(request_id);
CREATE INDEX IF NOT EXISTS idx_fbl_chunk_id   ON feedback_chunk_log(chunk_id);
CREATE INDEX IF NOT EXISTS idx_fbl_created_at ON feedback_chunk_log(created_at);
