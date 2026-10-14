-- ============================================================================
-- Migration 0011 — Réponses enregistrées : codes d'erreur et pannes fréquentes
-- ============================================================================
-- Les menus de suggestions du Copilote (« Codes d'erreur connus », « Pannes
-- fréquentes ») répondent avec un texte rédigé à l'avance, lu en base par
-- une simple requête SQL : ni LLM, ni embedding. Avant, ces réponses
-- vivaient dans des fichiers JSON du frontend (codes d'erreur) ou passaient
-- par /api/chat, donc par Claude et Voyage (pannes fréquentes).
-- ============================================================================
BEGIN;

-- Un code d'erreur n'apparaît dans les suggestions que s'il a un device_type
-- ET une réponse : les codes sans réponse restent trouvables par
-- /api/error_code/search, comme avant.
ALTER TABLE error_code ADD COLUMN IF NOT EXISTS device_type device_type;
ALTER TABLE error_code ADD COLUMN IF NOT EXISTS reply TEXT;  -- un paragraphe par ligne

-- Pannes fréquentes, rédigées par les administrateurs. Indépendantes du
-- catalogue symptom : ce sont des raccourcis d'interface, pas des symptômes
-- normalisés servant aux statistiques.
CREATE TABLE IF NOT EXISTS usual_problem (
    usual_problem_id SERIAL PRIMARY KEY,
    device_type      device_type NOT NULL,
    label            TEXT NOT NULL,              -- texte affiché dans le menu
    reply            TEXT NOT NULL,              -- un paragraphe par ligne
    display_order    INTEGER NOT NULL DEFAULT 0  -- ordre dans le menu (croissant)
);

CREATE INDEX IF NOT EXISTS idx_usual_problem_device_type ON usual_problem(device_type, display_order);

COMMIT;
