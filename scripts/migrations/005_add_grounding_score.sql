-- Migration 005: Add grounding_score to interaction_log
-- Supports Citation Verification (Task 21)

ALTER TABLE interaction_log
    ADD COLUMN IF NOT EXISTS grounding_score FLOAT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_interaction_log_grounding
    ON interaction_log (grounding_score)
    WHERE grounding_score IS NOT NULL;
