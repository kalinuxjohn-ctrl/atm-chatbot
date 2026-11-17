-- ============================================================================
-- Migration 0014 — main_app : schéma de l'application des techniciens
-- ============================================================================
-- La « main app » (dossier main-app/, Node.js) partage la base du chatbot,
-- mais range TOUTES ses tables dans le schéma main_app : le chatbot ne les
-- voit pas, et aucune table existante n'est modifiée.
--
-- Seul point de contact : public.technician, la table d'identité commune.
-- Chaque compte de la main app EST une ligne de technician.
--
-- Rôle SQL main_app_user : celui des conteneurs de la main app.
--   - lecture/écriture des données du schéma main_app (pas de DDL : les tables
--     ne changent que par migration) ;
--   - SELECT sur public.technician, INSERT pour créer un compte (jamais
--     d'UPDATE ni de DELETE sur les lignes du chatbot) ;
--   - aucun droit sur les autres tables du chatbot.
-- Il est créé SANS mot de passe (NOLOGIN) : ce mécanisme de migration ne
-- reçoit pas de variable d'environnement. Le job ponctuel
-- main-app-database-setup lui donne son mot de passe (MAIN_APP_DATABASE_PASSWORD)
-- et le droit de connexion, à chaque démarrage (voir docs/main-app.md).
-- ============================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS main_app;

-- citext : nom d'utilisateur insensible à la casse (« Alan » = « alan »).
-- cube + earthdistance : distances sur la Terre et index géographique, sans
-- PostGIS (l'image de la base ne change pas). Les trois sont fournis par
-- PostgreSQL (contrib).
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

DO $$ BEGIN
    -- technician : utilisateur de base ; moderator : gère tous les points de la carte ;
    -- admin : gère en plus les comptes et les rôles.
    CREATE TYPE main_app.account_role AS ENUM ('technician', 'moderator', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE ROLE main_app_user NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA main_app TO main_app_user;

-- Table d'identité partagée : lire les techniciens, et en créer un à
-- l'ouverture d'un compte. La séquence sert à obtenir le technician_id.
GRANT SELECT, INSERT ON public.technician TO main_app_user;
GRANT USAGE ON SEQUENCE public.technician_technician_id_seq TO main_app_user;

-- Les tables et séquences créées ENSUITE dans main_app (migrations 0015 à 0018)
-- reçoivent automatiquement ces droits.
ALTER DEFAULT PRIVILEGES IN SCHEMA main_app
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO main_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA main_app
    GRANT USAGE, SELECT ON SEQUENCES TO main_app_user;

COMMIT;
