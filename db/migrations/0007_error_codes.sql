-- 0007_error_codes.sql
-- Référentiel des codes d'erreur affichés par les équipements, et des
-- pannes ("fault") auxquelles ils sont rattachés. Indépendant du catalogue
-- symptôme/action (0002) : recherche texte classique uniquement, aucun lien
-- avec pgvector ou les embeddings (voir error_code_service.py).
--
-- IF NOT EXISTS partout : rendu idempotent car init-db rejoue les
-- migrations à chaque démarrage.

BEGIN;

CREATE TABLE IF NOT EXISTS fault (
    fault_id    SERIAL PRIMARY KEY,
    code        TEXT,           -- référence interne optionnelle (ex: 'P001')
    name        TEXT NOT NULL   -- ex: 'Surchauffe moteur'
);

CREATE TABLE IF NOT EXISTS error_code (
    error_code_id SERIAL PRIMARY KEY,
    code          TEXT NOT NULL,  -- ex: 'E42', tel qu'affiché sur l'équipement
    description   TEXT,
    fault_id      INTEGER REFERENCES fault(fault_id)  -- nullable : un code peut exister sans panne identifiée
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_error_code_code_ci ON error_code (UPPER(code));

COMMIT;