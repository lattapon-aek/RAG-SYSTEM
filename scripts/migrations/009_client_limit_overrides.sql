-- Migration 009: Persistent client limit overrides + admin action audit

CREATE TABLE IF NOT EXISTS client_limit_overrides (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_type  TEXT NOT NULL CHECK (config_type IN ('quota', 'rate_limit')),
    client_id    TEXT NOT NULL,
    limit_value  INTEGER NOT NULL CHECK (limit_value >= 0),
    notes        TEXT,
    updated_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (config_type, client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_limit_overrides_type_client
    ON client_limit_overrides(config_type, client_id);

CREATE TABLE IF NOT EXISTS admin_action_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id TEXT NOT NULL,
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    target_id     TEXT NOT NULL,
    before_value  JSONB,
    after_value   JSONB,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_created
    ON admin_action_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_resource
    ON admin_action_log(resource_type, target_id);
