-- ============================================================================
-- Migration 0004 — symptom_action_outcome_stats (§7.1 du design doc)
-- ============================================================================
BEGIN;

-- device_type fait partie de la clé : un (symptom_id, action_id) peut avoir
-- un taux de réussite différent sur GAB et sur TPE (mécaniques différentes),
-- donc une seule ligne "tous appareils confondus" mélangerait les deux et
-- fausserait le classement affiché au technicien.
CREATE TABLE symptom_action_outcome_stats (
    symptom_id      INTEGER NOT NULL REFERENCES symptom(symptom_id),
    action_id       INTEGER NOT NULL REFERENCES action(action_id),
    device_type     device_type NOT NULL,
    attempts        INTEGER NOT NULL,
    successes       INTEGER NOT NULL,
    accuracy_score  NUMERIC(5,4) NOT NULL,
    last_computed_at TIMESTAMP NOT NULL,
    PRIMARY KEY (symptom_id, action_id, device_type)
);

COMMIT;