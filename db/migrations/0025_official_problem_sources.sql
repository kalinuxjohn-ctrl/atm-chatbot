-- Preserve the source and provenance of manufacturer-documented usual problems.
BEGIN;

ALTER TABLE panne_frequente
    ADD COLUMN IF NOT EXISTS source_key TEXT,
    ADD COLUMN IF NOT EXISTS documentation JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_panne_frequente_source_key
    ON panne_frequente(source_key)
    WHERE source_key IS NOT NULL;

COMMIT;
