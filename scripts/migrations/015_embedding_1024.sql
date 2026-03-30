-- Migration 015: switch embedding/vector storage to 1024 dimensions.
-- Preserves old 768-dim tables as *_v768 archives when present.

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
DECLARE
    user_memory_dim text;
    chunk_cache_dim text;
BEGIN
    SELECT format_type(a.atttypid, a.atttypmod)
      INTO user_memory_dim
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'user_memory'
       AND a.attname = 'embedding'
       AND a.attnum > 0
       AND NOT a.attisdropped
     LIMIT 1;

    IF user_memory_dim = 'vector(768)' THEN
        ALTER TABLE user_memory RENAME TO user_memory_v768;
    END IF;

    SELECT format_type(a.atttypid, a.atttypmod)
      INTO chunk_cache_dim
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'chunk_embedding_cache'
       AND a.attname = 'embedding'
       AND a.attnum > 0
       AND NOT a.attisdropped
     LIMIT 1;

    IF chunk_cache_dim = 'vector(768)' THEN
        ALTER TABLE chunk_embedding_cache RENAME TO chunk_embedding_cache_v768;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_memory (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    content         TEXT NOT NULL,
    memory_type     TEXT NOT NULL DEFAULT 'general',
    embedding       vector(1024),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ,
    CONSTRAINT user_memory_pkey_v1024 PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_user_memory_user_v1024 ON user_memory(user_id);

CREATE TABLE IF NOT EXISTS chunk_embedding_cache (
    sha256_hash  CHAR(64) NOT NULL,
    model_name   VARCHAR(255) NOT NULL,
    embedding    vector(1024) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chunk_embedding_cache_pkey_v1024 PRIMARY KEY (sha256_hash, model_name)
);
