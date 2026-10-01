-- 0006_conversation_context.sql
-- Mémoire conversationnelle : historique des messages + contexte actif
-- (voir chat_context_implementation_spec.md).

CREATE TABLE conversation (
    conversation_id SERIAL PRIMARY KEY,
    technician_id   INTEGER NOT NULL REFERENCES technician(technician_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_technician ON conversation(technician_id);

CREATE TABLE conversation_message (
    message_id      SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversation(conversation_id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seul pattern d'accès nécessaire : lire l'historique d'une conversation
-- par ordre chronologique.
CREATE INDEX idx_message_conversation_created ON conversation_message(conversation_id, created_at);

-- Une ligne par conversation (1:1), séparée de `conversation` pour ne
-- jamais avoir à réécrire technician_id/created_at à chaque mise à jour
-- de contexte (qui arrive, elle, à chaque message).
CREATE TABLE conversation_context (
    conversation_id INTEGER PRIMARY KEY REFERENCES conversation(conversation_id) ON DELETE CASCADE,
    context         JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);