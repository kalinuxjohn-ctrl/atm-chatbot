-- ============================================================================
-- Migration 0015 — main_app : comptes, sessions, verrouillage des connexions
-- ============================================================================
-- Connexion par nom d'utilisateur + mot de passe UNIQUEMENT (ni email, ni
-- OAuth). Un compte EST un technicien : sa clé primaire est le technician_id
-- de public.technician (table du chatbot, jamais modifiée).
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS main_app.accounts (
    -- Supprimer le technicien côté chatbot supprime son compte : un compte
    -- n'a aucun sens sans l'identité qu'il représente.
    technician_id        INTEGER PRIMARY KEY REFERENCES public.technician(technician_id) ON DELETE CASCADE,
    -- citext : « Alan » et « alan » sont le même nom (unicité insensible à la casse).
    username             CITEXT NOT NULL UNIQUE,
    -- Empreinte argon2id (sel et paramètres inclus) : jamais le mot de passe.
    password_hash        TEXT NOT NULL,
    role                 main_app.account_role NOT NULL DEFAULT 'technician',
    -- Désactiver un compte coupe ses sessions sans perdre son historique.
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    -- Compteurs du COMPTE (statistiques et blocage administratif) ; le
    -- verrouillage anti-force brute, lui, est par nom + adresse IP (login_throttles).
    failed_login_count   INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
    last_failed_login_at TIMESTAMPTZ,
    last_login_at        TIMESTAMPTZ,
    password_changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Même règle que la validation de l'API : 3 à 30 caractères, lettres, chiffres, _ . -
    CONSTRAINT accounts_username_format CHECK (username ~ '^[a-zA-Z0-9_.-]{3,30}$')
);

CREATE TABLE IF NOT EXISTS main_app.sessions (
    -- SHA-256 du token du cookie : la base ne contient jamais le token lui-même.
    token_hash          TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
    technician_id       INTEGER NOT NULL REFERENCES main_app.accounts(technician_id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    created_ip_address  INET,
    created_user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_main_app_sessions_technician ON main_app.sessions(technician_id);
CREATE INDEX IF NOT EXISTS idx_main_app_sessions_expires_at ON main_app.sessions(expires_at);

-- Verrouillage temporaire après trop d'échecs, par (nom saisi, adresse IP).
-- Le nom saisi n'a PAS besoin d'exister : un attaquant obtient la même
-- réponse pour un compte existant ou non, et ne peut pas bloquer un collègue
-- depuis une autre adresse.
CREATE TABLE IF NOT EXISTS main_app.login_throttles (
    attempted_username  CITEXT NOT NULL,
    ip_address          INET NOT NULL,
    failed_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    first_failed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until        TIMESTAMPTZ,
    PRIMARY KEY (attempted_username, ip_address)
);

-- Droits de main_app_user : déjà donnés par ALTER DEFAULT PRIVILEGES (0014),
-- répétés ici pour qu'une base où 0014 a été appliquée par un autre rôle soit correcte.
GRANT SELECT, INSERT, UPDATE, DELETE ON main_app.accounts, main_app.sessions, main_app.login_throttles TO main_app_user;

COMMIT;
