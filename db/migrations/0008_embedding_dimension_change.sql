-- 0008_embedding_dimension_change.sql
-- Passage à Solon-embeddings-base-0.1 (768 dimensions) au lieu de
-- Solon-embeddings-large-0.1 (1024) -- modèle allégé, jetable, en attendant
-- l'API d'embedding externe de la version finale (voir config.py).
--
-- Un changement de dimension vector n'est pas un simple ALTER TYPE : on
-- supprime la colonne (et son index, qui en dépend) puis on les recrée.
-- Conséquence acceptée : les embeddings déjà calculés sont perdus -- sans
-- gravité ici, seed_demo_data.py les recalcule systématiquement au
-- démarrage (voir EMBEDDING_BACKFILL, déjà en place).

BEGIN;

DROP INDEX IF EXISTS idx_intervention_symptom_embedding;
ALTER TABLE intervention_symptom DROP COLUMN IF EXISTS embedding;
ALTER TABLE intervention_symptom ADD COLUMN embedding vector(768);

CREATE INDEX idx_intervention_symptom_embedding
    ON intervention_symptom
    USING hnsw (embedding vector_cosine_ops);

COMMIT;