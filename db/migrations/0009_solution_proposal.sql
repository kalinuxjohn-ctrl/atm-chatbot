-- ============================================================================
-- Migration 0009 — solution_proposal
-- ============================================================================
-- Solutions PROPOSÉES par un technicien quand aucune des solutions trouvées
-- par le Copilote n'a résolu son problème. Une proposition n'est PAS une
-- solution officielle : elle attend la décision d'un administrateur
-- (pending -> approved | rejected) et reste conservée dans tous les cas.
--
-- Le problème n'est jamais ressaisi par le technicien : le backend le relit
-- dans conversation_context au moment de l'envoi. Les colonnes ci-dessous en
-- gardent les identifiants utiles (tous facultatifs : une recherche sans
-- résultat n'a ni intervention ni symptôme de référence), et
-- conversation_context_snapshot en garde la photo complète, sans recopier
-- la conversation (les messages restent dans conversation_message).
-- ============================================================================
BEGIN;

DO $$ BEGIN
    CREATE TYPE solution_proposal_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS solution_proposal (
    proposal_id              SERIAL PRIMARY KEY,
    -- Pas de ON DELETE CASCADE : supprimer une conversation ne doit pas
    -- effacer l'historique des propositions.
    conversation_id          INTEGER NOT NULL REFERENCES conversation(conversation_id),
    technician_id            INTEGER NOT NULL REFERENCES technician(technician_id),

    -- Cas de référence : l'intervention PASSÉE à laquelle la recherche a
    -- rattaché le problème (résultat sélectionné, sinon le premier résultat).
    intervention_id          INTEGER REFERENCES intervention(intervention_id),
    intervention_symptom_id  INTEGER REFERENCES intervention_symptom(intervention_symptom_id),
    symptom_id               INTEGER REFERENCES symptom(symptom_id),
    component_id             INTEGER REFERENCES component(component_id),
    -- Appareil physique en cours de réparation : NULL tant que le chat n'est
    -- pas rattaché à une intervention en cours (seuls type et modèle sont connus).
    device_id                INTEGER REFERENCES device(device_id),
    device_type              device_type NOT NULL,
    model_id                 INTEGER REFERENCES device_model(model_id),
    error_code_id            INTEGER REFERENCES error_code(error_code_id),

    problem_text             TEXT NOT NULL,   -- problème tel que reformulé lors de la recherche
    proposed_action          TEXT NOT NULL,   -- ce que le technicien a fait
    result_description       TEXT NOT NULL,   -- ce qui s'est passé ensuite
    outcome_status           action_outcome NOT NULL DEFAULT 'resolved',
    conversation_context_snapshot JSONB NOT NULL,

    status                   solution_proposal_status NOT NULL DEFAULT 'pending',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at              TIMESTAMPTZ,
    reviewed_by              TEXT,
    admin_comment            TEXT,
    -- Action du catalogue créée ou réutilisée lors de l'approbation.
    approved_action_id       INTEGER REFERENCES action(action_id),

    -- Une décision est toujours datée et signée ; une proposition en attente ne l'est jamais.
    CONSTRAINT solution_proposal_review_consistency CHECK (
        (status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status <> 'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_solution_proposal_status_created ON solution_proposal(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_solution_proposal_conversation ON solution_proposal(conversation_id);

COMMIT;
