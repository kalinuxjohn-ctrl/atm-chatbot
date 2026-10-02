-- ============================================================================
-- Migration 0003 — pgvector : la couche recherche sémantique
-- ============================================================================
-- pgvector est une extension Postgres open-source et gratuite : pas besoin
-- d'une base de données vectorielle séparée (Pinecone, Weaviate...) à cette
-- échelle -- tout reste dans la même instance Postgres transactionnelle.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- On embarque UNE SEULE colonne d'embedding pour commencer, sur
-- intervention_symptom.raw_text : c'est là que la recherche sémantique a le
-- plus de valeur (retrouver "carte refusée alors qu'il y a assez d'argent"
-- même si un autre technicien a écrit "le distributeur refuse la carte du
-- client malgré un solde suffisant").
--
-- 1024 = dimension du modèle d'embedding Voyage AI utilisé (ex: voyage-3.5,
-- voyage-3-large). Si vous choisissez un modèle "lite" avec une dimension
-- différente (ex: 512), changez cette valeur AVANT de charger des données --
-- la dimension d'une colonne vector ne peut pas être modifiée après coup
-- sans tout réembarquer.
ALTER TABLE intervention_symptom ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- Index HNSW pour la recherche par similarité cosinus (l'opérateur <=>).
-- HNSW est recommandé plutôt qu'IVFFlat pour ce volume de données : pas
-- besoin de le reconstruire à mesure que la table grossit, et de meilleures
-- performances de recherche pour un coût d'insertion acceptable.
--
-- IMPORTANT : à créer une fois qu'il y a déjà un peu de données (même
-- quelques centaines de lignes), pas sur une table vide -- sinon Postgres
-- choisit des paramètres par défaut mal calibrés. Sur une base vide, cette
-- ligne peut être commentée et exécutée plus tard via une migration dédiée.
CREATE INDEX IF NOT EXISTS idx_intervention_symptom_embedding
    ON intervention_symptom
    USING hnsw (embedding vector_cosine_ops);

-- Colonnes d'embedding optionnelles mentionnées dans le design (désactivées
-- par défaut -- décommentez si vous voulez aussi chercher sur les notes
-- de synthèse ou le texte des actions) :
-- ALTER TABLE intervention ADD COLUMN summary_embedding vector(1024);
-- ALTER TABLE intervention_action ADD COLUMN raw_text_embedding vector(1024);

COMMIT;