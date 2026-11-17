-- ============================================================================
-- Migration 0001 — Schéma "noyau" : qui intervient, sur quel équipement, quand
-- ============================================================================
-- Cette migration met en place les tables 1.1 à 1.6 : technician, manufacturer,
-- device_model, device_model_version, device, intervention.
--
-- Principe de conception : on distingue deux catégories de colonnes.
-- - Les colonnes qui décrivent le MONDE EXTÉRIEUR au système (nom d'un
--   fabricant, référence d'un modèle, numéro de série physique...) : ce sont
--   des informations déclarées par un technicien sur le terrain, jamais
--   garanties propres ou uniques à l'échelle d'une ville -- donc PAS de
--   NOT NULL / UNIQUE strict dessus. Forcer ça casserait la saisie réelle.
-- - Les colonnes qui appartiennent AU SYSTÈME lui-même (qui a fait
--   l'intervention, sur quel enregistrement d'équipement, quand) : ce sont
--   nos propres données, on peut et doit rester strict dessus.
--
-- Idempotence : chaque instruction peut être rejouée sans erreur si elle a
-- déjà été appliquée (utile en dev, où on relance souvent sans repartir
-- d'une base vide). Postgres n'a pas de "CREATE TYPE IF NOT EXISTS" -- on
-- simule avec un bloc DO qui ignore l'erreur "déjà existant".

BEGIN;

-- gab = Guichet Automatique Bancaire (le gros distributeur de billets, "ATM")
-- tpe = Terminal de Paiement Électronique (le petit terminal de paiement/reçu)
-- Champ volontairement obligatoire malgré le relâchement des contraintes
-- ailleurs : c'est la distinction la plus structurante du système (elle
-- déterminera quels symptômes/actions du catalogue s'appliquent), donc on ne
-- peut pas se permettre qu'elle soit absente, même quand le reste (modèle,
-- fabricant) ne l'est pas.
DO $$ BEGIN
    CREATE TYPE device_type AS ENUM ('gab', 'tpe');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE device_status AS ENUM ('active', 'decommissioned', 'under_repair');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE intervention_outcome AS ENUM ('resolved', 'partially_resolved', 'unresolved', 'escalated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ----------------------------------------------------------------------------
-- 1.1 technician — les techniciens qui interviennent sur le terrain
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technician (
    technician_id   SERIAL PRIMARY KEY,
    full_name       TEXT NOT NULL,  -- identité du technicien : appartient au système, reste obligatoire
    employee_code   TEXT,           -- matricule interne à l'entreprise cliente -- pas garanti unique/renseigné par nous
    email           TEXT,
    phone           TEXT,
    region          TEXT,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);


-- ----------------------------------------------------------------------------
-- 1.2 manufacturer — fabricants (Diebold, NCR, Hyosung, Ingenico...)
-- Donnée externe : orthographe/complétude jamais garanties sur le terrain.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manufacturer (
    manufacturer_id SERIAL PRIMARY KEY,
    name            TEXT
);


-- ----------------------------------------------------------------------------
-- 1.3 device_model — modèles d'équipement (un modèle = plusieurs unités)
-- Renommé depuis atm_model : couvre maintenant aussi les modèles de TPE.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_model (
    model_id        SERIAL PRIMARY KEY,
    manufacturer_id INTEGER REFERENCES manufacturer(manufacturer_id),  -- nullable : fabricant pas toujours identifié
    model_name      TEXT,
    category        TEXT,
    release_year    INTEGER
);


-- ----------------------------------------------------------------------------
-- 1.4 device_model_version — révisions firmware/matériel d'un modèle
-- Renseignée seulement quand une révision précise change vraiment le
-- comportement (bug connu, procédure différente) -- pas systématique.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_model_version (
    version_id      SERIAL PRIMARY KEY,
    model_id        INTEGER REFERENCES device_model(model_id),
    version_label   TEXT,
    hardware_rev    TEXT,
    notes           TEXT
);


-- ----------------------------------------------------------------------------
-- 1.5 device — chaque équipement physique déployé sur le terrain (GAB ou TPE)
-- Renommé depuis atm : le nom "atm" ne convenait plus puisque cette table
-- couvre aussi les TPE, qui ne sont pas des distributeurs de billets.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device (
    device_id       SERIAL PRIMARY KEY,
    device_type     device_type NOT NULL,  -- GAB ou TPE -- voir la remarque plus haut, seule colonne "externe" restée obligatoire
    serial_number   TEXT,                  -- pas UNIQUE/NOT NULL : saisie terrain, doublons/erreurs possibles
    model_id        INTEGER REFERENCES device_model(model_id),  -- nullable : modèle pas toujours identifié sur place
    site_name       TEXT,
    address         TEXT,
    install_date    DATE,
    status          device_status NOT NULL DEFAULT 'active'
);


-- ----------------------------------------------------------------------------
-- 1.6 intervention — le "ticket" : une visite technique sur un équipement donné
-- Table centrale du système : ici on reste strict, ce sont nos propres
-- données (pas des informations déclarées sur du matériel externe).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intervention (
    intervention_id     SERIAL PRIMARY KEY,
    device_id           INTEGER NOT NULL REFERENCES device(device_id),
    technician_id       INTEGER NOT NULL REFERENCES technician(technician_id),
    ticket_reference    TEXT,
    opened_at           TIMESTAMP NOT NULL,
    closed_at           TIMESTAMP,
    final_outcome_status intervention_outcome,
    summary_text        TEXT
);

CREATE INDEX IF NOT EXISTS idx_intervention_device_id ON intervention(device_id);
CREATE INDEX IF NOT EXISTS idx_intervention_technician_id ON intervention(technician_id);
CREATE INDEX IF NOT EXISTS idx_intervention_opened_at ON intervention(opened_at DESC);

COMMIT;