-- Migration 017: Chat Identities
-- Stores reusable chat user/client identity pairs for dashboard and MCP usage.

CREATE TABLE IF NOT EXISTS chat_identities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(255) UNIQUE NOT NULL,
    description  TEXT,
    namespace    VARCHAR(255) NOT NULL DEFAULT 'default',
    client_id    VARCHAR(255) NOT NULL,
    user_id      VARCHAR(255) NOT NULL,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_identities_name
    ON chat_identities(name);

CREATE INDEX IF NOT EXISTS idx_chat_identities_client
    ON chat_identities(client_id);

CREATE INDEX IF NOT EXISTS idx_chat_identities_user
    ON chat_identities(user_id);

CREATE INDEX IF NOT EXISTS idx_chat_identities_revoked_at
    ON chat_identities(revoked_at);
