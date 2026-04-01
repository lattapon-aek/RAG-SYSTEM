-- Migration 020: Rename interaction_log generation latency to answer latency
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'interaction_log'
          AND column_name = 'generation_latency_ms'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'interaction_log'
              AND column_name = 'answer_latency_ms'
        ) THEN
            EXECUTE 'ALTER TABLE interaction_log RENAME COLUMN generation_latency_ms TO answer_latency_ms';
        ELSE
            EXECUTE 'UPDATE interaction_log
                     SET answer_latency_ms = COALESCE(answer_latency_ms, generation_latency_ms)
                     WHERE generation_latency_ms IS NOT NULL';
            EXECUTE 'ALTER TABLE interaction_log DROP COLUMN generation_latency_ms';
        END IF;
    END IF;
END $$;
