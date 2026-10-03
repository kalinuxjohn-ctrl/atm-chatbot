-- 0008_embedding_dimension_voyage.sql
-- Passage à Voyage AI (voyage-3-large, output_dimension=1024) à la place
-- de Solon en local. Voyage n'accepte que 256/512/1024/2048 comme
-- dimension -- 768 (valeur précédente) n'est pas possible, d'où cette
-- nouvelle migration plutôt qu'une simple ré-utilisation de 0008/0009.

BEGIN;

DROP INDEX IF EXISTS idx_intervention_symptom_embedding;
ALTER TABLE intervention_symptom DROP COLUMN IF EXISTS embedding;
ALTER TABLE intervention_symptom ADD COLUMN embedding vector(1024);

CREATE INDEX idx_intervention_symptom_embedding
    ON intervention_symptom
    USING hnsw (embedding vector_cosine_ops);

COMMIT;