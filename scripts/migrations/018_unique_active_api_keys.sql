-- Migration 018: Unique active API keys per client
-- Enforces a single active key per client_id while preserving revoked history.

WITH ranked_active_keys AS (
    SELECT
        id,
        client_id,
        ROW_NUMBER() OVER (
            PARTITION BY client_id
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_active_client
    ON api_keys(client_id)
    WHERE revoked_at IS NULL;
