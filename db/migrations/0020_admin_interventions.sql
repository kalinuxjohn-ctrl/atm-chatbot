-- Un ajout direct signe par l'admin n'est pas une visite de technicien.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.intervention
    ALTER COLUMN technician_id DROP NOT NULL,
    ADD COLUMN created_by_admin TEXT,
    ADD CONSTRAINT intervention_author_check CHECK (
        (technician_id IS NOT NULL AND created_by_admin IS NULL)
        OR (technician_id IS NULL AND NULLIF(btrim(created_by_admin), '') IS NOT NULL)
    );

ALTER TABLE public.ajout_intervention
    ALTER COLUMN technician_id DROP NOT NULL,
    ADD COLUMN created_by_admin TEXT,
    ADD CONSTRAINT ajout_intervention_author_check CHECK (
        (technician_id IS NOT NULL AND created_by_admin IS NULL)
        OR (
            technician_id IS NULL AND NULLIF(btrim(created_by_admin), '') IS NOT NULL
            AND conversation_id IS NULL AND status = 'approved'
            AND created_intervention_id IS NOT NULL
        )
    );

COMMIT;
