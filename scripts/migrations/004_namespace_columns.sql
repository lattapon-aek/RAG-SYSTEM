-- Migration 004: Namespace Columns
-- Adds namespace support to documents and chunks for multi-tenant isolation

ALTER TABLE documents ADD COLUMN IF NOT EXISTS namespace VARCHAR(255) NOT NULL DEFAULT 'default';
ALTER TABLE chunks    ADD COLUMN IF NOT EXISTS namespace VARCHAR(255) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_documents_namespace ON documents(namespace);
CREATE INDEX IF NOT EXISTS idx_chunks_namespace    ON chunks(namespace);
