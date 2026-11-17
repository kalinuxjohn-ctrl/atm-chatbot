-- ============================================================================
-- Migration 0016 — main_app : points de la carte partagée
-- ============================================================================
-- Les techniciens marquent des lieux utiles (site de GAB, client TPE, dépôt
-- de pièces...). Tout utilisateur connecté voit tous les points ; chacun
-- modifie ou supprime les siens, modérateurs et admins gèrent tous les points.
--
-- Recherche géographique sans PostGIS : extensions cube + earthdistance
-- (0014). ll_to_earth(lat, lon) place le point sur la sphère terrestre, et
-- l'index GiST rend rapide la recherche « points à moins de N mètres ».
-- ============================================================================
BEGIN;

DO $$ BEGIN
    CREATE TYPE main_app.map_point_category AS ENUM (
        'atm_site',          -- site de GAB (distributeur)
        'tpe_client',        -- client équipé d'un TPE
        'parts_depot',       -- dépôt ou stock de pièces
        'difficult_access',  -- accès difficile (badge, horaires, parking...)
        'other'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS main_app.map_points (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    description  TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
    category     main_app.map_point_category NOT NULL DEFAULT 'other',
    latitude     DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude    DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    -- Auteur. SET NULL et non CASCADE : un lieu utile (accès à un GAB) reste
    -- sur la carte si son auteur disparaît ; seuls modérateurs et admins le gèrent alors.
    created_by   INTEGER REFERENCES public.technician(technician_id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recherche par proximité (earth_box / earth_distance).
CREATE INDEX IF NOT EXISTS idx_main_app_map_points_earth
    ON main_app.map_points USING gist (ll_to_earth(latitude, longitude));
-- Recherche par zone visible de la carte (bbox).
CREATE INDEX IF NOT EXISTS idx_main_app_map_points_latitude_longitude
    ON main_app.map_points (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_main_app_map_points_created_by
    ON main_app.map_points (created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON main_app.map_points TO main_app_user;

COMMIT;
