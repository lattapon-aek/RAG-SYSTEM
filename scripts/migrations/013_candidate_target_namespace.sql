-- Migration 013: Add target_namespace to approval_queue
-- Tracks which namespace a knowledge candidate should be ingested into when approved.
-- Previously auto-ingest always used "default"; now it uses the namespace
-- from the knowledge_gap that triggered the candidate.

ALTER TABLE approval_queue
    ADD COLUMN IF NOT EXISTS target_namespace VARCHAR(255) NOT NULL DEFAULT 'default';
