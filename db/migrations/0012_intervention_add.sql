-- ============================================================================
-- Migration 0012 — intervention_add
-- ============================================================================
-- Demande d'ajout d'intervention ENVOYÉE par un technicien (souvent quand le Copilote
-- ne connaît pas le problème), en attente de validation par un administrateur.
--
-- Tant qu'elle n'est pas approuvée, la demande n'écrit RIEN dans intervention,
-- intervention_symptom, intervention_action ni diagnosis : la recherche des
-- autres techniciens ne la voit donc pas.
--
--     pending ──(admin approuve)──> approved : lignes créées, created_intervention_id rempli
--             ──(admin rejette)───> rejected : rien n'est créé, la demande reste en historique
--
-- Le contenu est gardé en JSONB, en deux exemplaires :
-- - submitted_content : ce que le technicien a envoyé, jamais modifié ;
-- - content           : la version que l'administrateur peut corriger et qui
--                       sera écrite à l'approbation.
-- ============================================================================
BEGIN;

DO $$ BEGIN
    CREATE TYPE intervention_add_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS intervention_add (
    intervention_add_id               SERIAL PRIMARY KEY,
    technician_id           INTEGER NOT NULL REFERENCES technician(technician_id),
    -- Conversation d'où vient la demande, si le technicien l'a envoyée depuis le chat.
    conversation_id         INTEGER REFERENCES conversation(conversation_id),

    submitted_content       JSONB NOT NULL,
    content                 JSONB NOT NULL,

    status                  intervention_add_status NOT NULL DEFAULT 'pending',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_edited_at          TIMESTAMPTZ,
    last_edited_by          TEXT,
    reviewed_at             TIMESTAMPTZ,
    reviewed_by             TEXT,
    admin_comment           TEXT,
    -- Intervention créée à l'approbation.
    created_intervention_id INTEGER REFERENCES intervention(intervention_id),

    -- Une décision est toujours datée et signée ; une demande en attente ne l'est jamais.
    CONSTRAINT intervention_add_review_consistency CHECK (
        (status = 'pending' AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status <> 'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    ),
    -- Seule une demande approuvée a une intervention créée.
    CONSTRAINT intervention_add_created_only_when_approved CHECK (
        created_intervention_id IS NULL OR status = 'approved'
    )
);

CREATE INDEX IF NOT EXISTS idx_intervention_add_status_created ON intervention_add(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intervention_add_technician ON intervention_add(technician_id);

COMMIT;
