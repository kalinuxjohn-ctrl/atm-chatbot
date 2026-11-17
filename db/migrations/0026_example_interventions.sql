-- Isolate reversible reference interventions and the virtual devices they use.
BEGIN;

ALTER TABLE intervention ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE appareil ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE panne_frequente ADD COLUMN IF NOT EXISTS source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_intervention_source_key
    ON intervention(source_key)
    WHERE source_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_appareil_source_key
    ON appareil(source_key)
    WHERE source_key IS NOT NULL;

COMMIT;
