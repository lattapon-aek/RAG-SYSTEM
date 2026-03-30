-- Migration 017: Memory Profiles
-- Stores profile metadata separately from memory entries so profiles can exist before any memory is saved.

CREATE TABLE IF NOT EXISTS memory_profiles (
    user_id     TEXT PRIMARY KEY,
    label       TEXT,
    notes       TEXT,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO memory_profiles (user_id)
SELECT DISTINCT um.user_id
FROM user_memory um
ON CONFLICT (user_id) DO NOTHING;
