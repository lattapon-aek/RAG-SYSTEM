-- Migration 012: Namespace metadata table
-- Stores description and metadata per namespace (one row per logical namespace)

CREATE TABLE IF NOT EXISTS namespace_metadata (
    namespace   VARCHAR(255) PRIMARY KEY,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-populate from existing documents
INSERT INTO namespace_metadata (namespace)
SELECT DISTINCT namespace FROM documents
ON CONFLICT (namespace) DO NOTHING;
