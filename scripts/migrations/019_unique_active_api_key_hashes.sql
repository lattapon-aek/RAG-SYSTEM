-- Migration 019: Unique active API key hashes
-- Prevents the same active API key from being reused across different client_id values.

WITH ranked_active_keys AS (
    SELECT
        id,
        hashed_key,
        ROW_NUMBER() OVER (
            PARTITION BY hashed_key
            ORDER BY created_at DESC, id DESC
        ) AS rn
    FROM api_keys
    WHERE revoked_at IS NULL
)
UPDATE api_keys a
SET revoked_at = NOW()
FROM ranked_active_keys r
WHERE a.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_active_hash
    ON api_keys(hashed_key)
    WHERE revoked_at IS NULL;
