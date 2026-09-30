-- ============================================================================
-- Migration 0005 — relier une action au symptôme précis qu'elle visait
-- ============================================================================
-- Avant : une action tentée était comptée pour TOUS les symptômes de
-- l'intervention (faux si l'intervention en a plusieurs). Ce champ permet
-- de dire "cette action visait CE symptôme précis". NULL = comportement
-- d'avant conservé (action générale, comptée pour tous les symptômes).

BEGIN;

ALTER TABLE intervention_action
    ADD COLUMN targets_symptom_id INTEGER REFERENCES intervention_symptom(intervention_symptom_id);

COMMIT;