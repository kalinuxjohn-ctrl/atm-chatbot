-- ============================================================================
-- Migration 0010 — intervention_action.source_proposal_id
-- ============================================================================
-- Une proposition de solution approuvée est rattachée au problème qu'elle
-- résout : une ligne intervention_action est ajoutée à l'intervention de
-- référence, avec targets_symptom_id = le symptôme (déjà vectorisé) de ce
-- problème. Aucun embedding n'est recalculé.
--
-- Cette colonne dit d'où vient la ligne : NULL = action réalisée pendant la
-- visite d'origine ; sinon = solution ajoutée APRÈS coup par validation
-- d'une proposition. Sans elle, la solution aurait l'air d'avoir été faite
-- pendant la visite, par le technicien d'origine.
-- ============================================================================
BEGIN;

ALTER TABLE intervention_action
    ADD COLUMN IF NOT EXISTS source_proposal_id INTEGER REFERENCES solution_proposal(proposal_id);

-- Une proposition n'est rattachée qu'une seule fois.
CREATE UNIQUE INDEX IF NOT EXISTS idx_intervention_action_source_proposal
    ON intervention_action(source_proposal_id) WHERE source_proposal_id IS NOT NULL;

COMMIT;
