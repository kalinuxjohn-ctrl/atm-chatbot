
-- 0006_conversation_context.sql
-- Mémoire conversationnelle : historique des messages + contexte actif.
-- IF NOT EXISTS partout : rendu idempotent car init-db rejoue les
-- migrations à chaque démarrage (voir correctif propre à venir avec une
-- vraie table de suivi des migrations appliquées).

CREATE TABLE IF NOT EXISTS conversation (
    conversation_id SERIAL PRIMARY KEY,
    technician_id   INTEGER NOT NULL REFERENCES technician(technician_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_technician ON conversation(technician_id);

CREATE TABLE IF NOT EXISTS conversation_message (
    message_id      SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversation(conversation_id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_conversation_created ON conversation_message(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS conversation_context (
    conversation_id INTEGER PRIMARY KEY REFERENCES conversation(conversation_id) ON DELETE CASCADE,
    context         JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);