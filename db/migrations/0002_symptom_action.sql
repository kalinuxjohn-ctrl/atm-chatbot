-- ============================================================================
-- Migration 0002 — Catalogue (symptom/action) + tables de jonction + diagnostic
-- ============================================================================
-- Principe clé du design : on sépare le CATALOGUE (le vocabulaire normalisé,
-- réutilisable) de l'ENREGISTREMENT (ce qu'un technicien a écrit, tel quel,
-- pour une intervention précise). Les deux se rejoignent via des tables de
-- jonction (intervention_symptom, intervention_action), qui portent le texte
-- brut + un lien optionnel vers l'entrée catalogue correspondante.

BEGIN;

DO $$ BEGIN
    CREATE TYPE action_outcome AS ENUM ('resolved', 'partial', 'no_effect', 'made_worse', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ----------------------------------------------------------------------------
-- 1.7 component — sous-systèmes de l'équipement (lecteur de carte, distributeur
-- de billets, imprimante reçu, module réseau, clavier PIN...).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS component (
    component_id    SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE
);


-- ----------------------------------------------------------------------------
-- 1.8 symptom — catalogue des symptômes NORMALISÉS (vocabulaire contrôlé).
-- Pas de device_type ici : un symptôme catalogué reste générique. La
-- distinction GAB/TPE se fait au niveau des statistiques (migration 0004),
-- via l'appareil réel de l'intervention -- pas une étiquette figée ici.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS symptom (
    symptom_id      SERIAL PRIMARY KEY,
    canonical_text  TEXT NOT NULL,
    component_id    INTEGER REFERENCES component(component_id)
);


-- ----------------------------------------------------------------------------
-- 1.9 intervention_symptom — jonction : ce qui a été observé RÉELLEMENT dans
-- CETTE intervention précise. La recherche sémantique s'appuiera sur raw_text.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intervention_symptom (
    intervention_symptom_id SERIAL PRIMARY KEY,
    intervention_id         INTEGER NOT NULL REFERENCES intervention(intervention_id),
    symptom_id              INTEGER REFERENCES symptom(symptom_id),  -- NULL si pas encore catalogué/normalisé
    raw_text                TEXT NOT NULL,   -- formulation exacte du technicien
    severity                TEXT
);

CREATE INDEX IF NOT EXISTS idx_intervention_symptom_intervention_id ON intervention_symptom(intervention_id);
CREATE INDEX IF NOT EXISTS idx_intervention_symptom_symptom_id ON intervention_symptom(symptom_id);


-- ----------------------------------------------------------------------------
-- 1.10 action — catalogue des actions/procédures connues. Même logique que
-- symptom : générique, sans device_type (voir remarque ci-dessus).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS action (
    action_id       SERIAL PRIMARY KEY,
    canonical_text  TEXT NOT NULL,
    component_id    INTEGER REFERENCES component(component_id)
);


-- ----------------------------------------------------------------------------
-- 1.11 intervention_action — jonction : ce qui a été fait, DANS L'ORDRE, et
-- ce qui en est résulté.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intervention_action (
    intervention_action_id SERIAL PRIMARY KEY,
    intervention_id         INTEGER NOT NULL REFERENCES intervention(intervention_id),
    action_id               INTEGER REFERENCES action(action_id),  -- NULL si action pas encore cataloguée
    raw_text                 TEXT NOT NULL,
    sequence_order           INTEGER NOT NULL,
    performed_at              TIMESTAMP,
    result_description        TEXT NOT NULL,
    outcome_status             action_outcome NOT NULL DEFAULT 'unknown',
    is_confirmed_solution      BOOLEAN NOT NULL DEFAULT FALSE  -- LE flag qui répond à "ça a marché ?"
);

CREATE INDEX IF NOT EXISTS idx_intervention_action_intervention_id ON intervention_action(intervention_id);
CREATE INDEX IF NOT EXISTS idx_intervention_action_action_id ON intervention_action(action_id);
CREATE INDEX IF NOT EXISTS idx_intervention_action_confirmed ON intervention_action(action_id) WHERE is_confirmed_solution = TRUE;


-- ----------------------------------------------------------------------------
-- 1.12 diagnosis — le "pourquoi", quand il est connu (facultatif).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diagnosis (
    diagnosis_id             SERIAL PRIMARY KEY,
    intervention_id           INTEGER NOT NULL REFERENCES intervention(intervention_id),
    description                TEXT NOT NULL,
    root_cause_component_id     INTEGER REFERENCES component(component_id),
    confirmed                   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_intervention_id ON diagnosis(intervention_id);

COMMIT;