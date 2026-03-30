-- Migration 008: Knowledge gap log deduplication
-- Adds query_hash, occurrence_count, last_seen, status so repeated identical
-- queries upsert into one row instead of creating unbounded duplicates.

ALTER TABLE knowledge_gap_log
    ADD COLUMN IF NOT EXISTS query_hash     TEXT,
    ADD COLUMN IF NOT EXISTS occurrence_count INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS last_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'promoted', 'ignored'));

-- Back-fill hash for existing rows (MD5 of lower-trimmed query)
UPDATE knowledge_gap_log
SET query_hash = MD5(LOWER(TRIM(query_text)))
WHERE query_hash IS NULL;

-- Unique index for upsert ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_gap_log_hash_ns
    ON knowledge_gap_log (query_hash, namespace);

-- Index for status-filtered queries (dashboard listing open gaps)
CREATE INDEX IF NOT EXISTS idx_knowledge_gap_log_status
    ON knowledge_gap_log (status, logged_at DESC);
