ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS label VARCHAR(255),
ADD COLUMN IF NOT EXISTS key_prefix VARCHAR(64),
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_at
    ON api_keys(revoked_at);

CREATE INDEX IF NOT EXISTS idx_api_keys_last_used_at
    ON api_keys(last_used_at DESC);
