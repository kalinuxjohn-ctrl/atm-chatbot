-- ============================================================================
-- Migration 0017 — main_app : messagerie entre techniciens
-- ============================================================================
-- Conversations directes (2 personnes). La table des participants permet
-- d'ajouter des groupes plus tard sans changer le schéma.
--
-- Un message est du TEXTE BRUT (stocké tel quel en UTF-8 : emojis libres,
-- jamais interprété comme du HTML), éventuellement accompagné d'UNE pièce
-- jointe : image ou audio. Pas de vidéo.
--
-- Les fichiers sont sur le volume main-app-uploads, sous un nom aléatoire ;
-- la base ne garde que ce nom, le type vérifié et la taille.
-- ============================================================================
BEGIN;

DO $$ BEGIN
    CREATE TYPE main_app.conversation_kind AS ENUM ('direct', 'group');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE main_app.message_kind AS ENUM ('text', 'image', 'audio');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS main_app.conversations (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind                     main_app.conversation_kind NOT NULL DEFAULT 'direct',
    -- Conversation directe : « plus petit id:plus grand id » des deux
    -- participants. UNIQUE : jamais deux conversations directes entre les
    -- deux mêmes personnes, même si elles l'ouvrent en même temps.
    direct_participants_key  TEXT UNIQUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at          TIMESTAMPTZ,

    CONSTRAINT conversations_direct_has_key CHECK (kind <> 'direct' OR direct_participants_key IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS main_app.conversation_participants (
    conversation_id       BIGINT NOT NULL REFERENCES main_app.conversations(id) ON DELETE CASCADE,
    technician_id         INTEGER NOT NULL REFERENCES public.technician(technician_id) ON DELETE CASCADE,
    joined_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Dernier message lu : sert au compteur « non lus ».
    last_read_message_id  BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, technician_id)
);

CREATE INDEX IF NOT EXISTS idx_main_app_conversation_participants_technician
    ON main_app.conversation_participants(technician_id);

CREATE TABLE IF NOT EXISTS main_app.messages (
    -- Identifiant croissant : sert de curseur au polling (« messages après n »).
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id       BIGINT NOT NULL REFERENCES main_app.conversations(id) ON DELETE CASCADE,
    sender_technician_id  INTEGER NOT NULL REFERENCES public.technician(technician_id) ON DELETE CASCADE,
    kind                  main_app.message_kind NOT NULL DEFAULT 'text',
    -- Texte brut, ou légende d'une pièce jointe (peut alors être vide).
    text_content          TEXT NOT NULL DEFAULT '' CHECK (char_length(text_content) <= 2000),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT messages_text_is_not_empty CHECK (kind <> 'text' OR char_length(text_content) > 0)
);

CREATE INDEX IF NOT EXISTS idx_main_app_messages_conversation_id
    ON main_app.messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS main_app.message_attachments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Une pièce jointe par message.
    message_id         BIGINT NOT NULL UNIQUE REFERENCES main_app.messages(id) ON DELETE CASCADE,
    -- Nom aléatoire sur le volume (jamais le nom envoyé par l'utilisateur).
    storage_file_name  TEXT NOT NULL UNIQUE CHECK (storage_file_name ~ '^[0-9a-f-]{36}$'),
    -- Type vérifié par la signature du fichier, pas celui annoncé par le navigateur.
    media_type         TEXT NOT NULL CHECK (media_type ~ '^(image|audio)/[a-z0-9.+-]+$'),
    byte_size          INTEGER NOT NULL CHECK (byte_size > 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON main_app.conversations, main_app.conversation_participants, main_app.messages, main_app.message_attachments
    TO main_app_user;

COMMIT;
