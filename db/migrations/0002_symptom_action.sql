-- ============================================================================
-- Migration 0002 — Catalogue (symptom/action) + tables de jonction + diagnostic
-- ============================================================================
-- Principe clé du design (voir doc §0) : on sépare le CATALOGUE (le vocabulaire
-- normalisé, réutilisable) de l'ENREGISTREMENT (ce qu'un technicien a écrit,
-- tel quel, pour une intervention précise). Les deux se rejoignent via des
-- tables de jonction (intervention_symptom, intervention_action), qui portent
-- le texte brut + un lien optionnel vers l'entrée catalogue correspondante.

BEGIN;

CREATE TYPE action_outcome AS ENUM ('resolved', 'partial', 'no_effect', 'made_worse', 'unknown');


-- ----------------------------------------------------------------------------
-- 1.7 component — sous-systèmes de l'ATM (lecteur de carte, distributeur de
-- billets, imprimante reçu, module réseau, clavier PIN...). Facultatif mais
-- utile pour filtrer/parcourir le catalogue par sous-système.
-- ----------------------------------------------------------------------------
CREATE TABLE component (
    component_id    SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE
);


-- ----------------------------------------------------------------------------
-- 1.8 symptom — catalogue des symptômes NORMALISÉS (vocabulaire contrôlé).
-- Cette table grandit avec le temps, au fur et à mesure qu'on regroupe des
-- formulations différentes sous un même concept. Le texte brut du technicien
-- n'est PAS forcé ici directement -> voir intervention_symptom ci-dessous.
-- ----------------------------------------------------------------------------
CREATE TABLE symptom (
    symptom_id      SERIAL PRIMARY KEY,
    canonical_text  TEXT NOT NULL,
    component_id    INTEGER REFERENCES component(component_id)
);


-- ----------------------------------------------------------------------------
-- 1.9 intervention_symptom — jonction : ce qui a été observé RÉELLEMENT dans
-- CETTE intervention précise. C'est ICI que la recherche sémantique s'appuie
-- (l'embedding sera calculé sur raw_text, pas sur canonical_text) -> voir
-- migration 0003 pour la colonne embedding.
-- ----------------------------------------------------------------------------
CREATE TABLE intervention_symptom (
    intervention_symptom_id SERIAL PRIMARY KEY,
    intervention_id         INTEGER NOT NULL REFERENCES intervention(intervention_id),
    symptom_id              INTEGER REFERENCES symptom(symptom_id),  -- NULL si pas encore catalogué/normalisé
    raw_text                TEXT NOT NULL,   -- formulation exacte du technicien
    severity                TEXT
);

CREATE INDEX idx_intervention_symptom_intervention_id ON intervention_symptom(intervention_id);
CREATE INDEX idx_intervention_symptom_symptom_id ON intervention_symptom(symptom_id);


-- ----------------------------------------------------------------------------
-- 1.10 action — catalogue des actions/procédures connues (ex: "Réinitialiser
-- le lecteur de carte"). Même logique que symptom : vocabulaire normalisé.
-- ----------------------------------------------------------------------------
CREATE TABLE action (
    action_id       SERIAL PRIMARY KEY,
    canonical_text  TEXT NOT NULL,
    component_id    INTEGER REFERENCES component(component_id)
);


-- ----------------------------------------------------------------------------
-- 1.11 intervention_action — jonction : ce qui a été fait, DANS L'ORDRE, et
-- ce qui en est résulté. result_description et is_confirmed_solution sont
-- placés directement ici (plutôt que dans une table "result" séparée) car la
-- relation est 1:1 -- un résultat appartient à une seule action tentée.
-- ----------------------------------------------------------------------------
CREATE TABLE intervention_action (
    intervention_action_id SERIAL PRIMARY KEY,
    intervention_id         INTEGER NOT NULL REFERENCES intervention(intervention_id),
    action_id               INTEGER REFERENCES action(action_id),  -- NULL si action pas encore cataloguée
    raw_text                 TEXT NOT NULL,   -- description du technicien de ce qu'il a fait
    sequence_order           INTEGER NOT NULL,  -- ordre de tentative (1, 2, 3...)
    performed_at              TIMESTAMP,
    result_description        TEXT NOT NULL,
    outcome_status             action_outcome NOT NULL DEFAULT 'unknown',
    is_confirmed_solution      BOOLEAN NOT NULL DEFAULT FALSE  -- LE flag qui répond à "ça a marché ?"
);

CREATE INDEX idx_intervention_action_intervention_id ON intervention_action(intervention_id);
CREATE INDEX idx_intervention_action_action_id ON intervention_action(action_id);
-- Index partiel : accélère spécifiquement les requêtes "quelles actions ont
-- confirmé résoudre le problème" (utilisées par 0004 pour les stats).
CREATE INDEX idx_intervention_action_confirmed ON intervention_action(action_id) WHERE is_confirmed_solution = TRUE;


-- ----------------------------------------------------------------------------
-- 1.12 diagnosis — le "pourquoi", quand il est connu (facultatif). Une
-- intervention peut avoir plusieurs lignes de diagnostic au fil du temps
-- (ex: diagnostic révisé après coup) -> d'où le 1:N plutôt que 1:1.
-- ----------------------------------------------------------------------------
CREATE TABLE diagnosis (
    diagnosis_id             SERIAL PRIMARY KEY,
    intervention_id           INTEGER NOT NULL REFERENCES intervention(intervention_id),
    description                TEXT NOT NULL,
    root_cause_component_id     INTEGER REFERENCES component(component_id),
    confirmed                   BOOLEAN NOT NULL DEFAULT FALSE  -- distingue une cause confirmée d'une hypothèse
);

CREATE INDEX idx_diagnosis_intervention_id ON diagnosis(intervention_id);

COMMIT;
