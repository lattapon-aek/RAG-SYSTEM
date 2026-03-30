-- Migration 003: Document Versioning
-- Adds document_versions table to track ingestion history per document

CREATE TABLE IF NOT EXISTS document_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id),
    version     INT  NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    chunk_count INT  NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (document_id, version)
);
CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id, version DESC);
