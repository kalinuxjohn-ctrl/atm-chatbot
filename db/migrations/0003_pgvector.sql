-- ============================================================================
-- Migration 0003 — pgvector : la couche recherche sémantique
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- 1024 = dimension du modèle Voyage AI utilisé. Si un modèle "lite" à
-- dimension différente est choisi, changer cette valeur AVANT de charger
-- des données (la dimension n'est pas modifiable après coup sans réembarquer).
ALTER TABLE intervention_symptom ADD COLUMN embedding vector(1024);

-- Index HNSW (recherche par similarité cosinus, opérateur <=>).
-- À créer une fois qu'il y a un peu de données, pas sur une table vide.
CREATE INDEX idx_intervention_symptom_embedding
    ON intervention_symptom
    USING hnsw (embedding vector_cosine_ops);

-- Colonnes d'embedding optionnelles (désactivées par défaut) :
-- ALTER TABLE intervention ADD COLUMN summary_embedding vector(1024);
-- ALTER TABLE intervention_action ADD COLUMN raw_text_embedding vector(1024);

COMMIT;
