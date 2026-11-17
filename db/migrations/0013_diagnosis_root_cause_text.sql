-- ============================================================================
-- Migration 0013 — pièce en cause en texte libre
-- ============================================================================
-- diagnosis.root_cause_component_id oblige à créer la pièce dans la table
-- component AVANT de pouvoir la citer. Le technicien écrit désormais la pièce
-- en cause comme il la nomme (« capteur de rétention », « courroie du
-- distributeur »...) : aucune liste, aucun ENUM, aucune clé étrangère.
--
-- root_cause_component_id reste en place (anciennes données), mais n'est plus
-- nécessaire. Les diagnostics qui n'avaient que l'ID reçoivent le nom de la
-- pièce, pour que tout se lise au même endroit.
--
-- Lue seulement quand le technicien demande le détail d'un cas
-- (case_detail_service.py) : la recherche par symptôme n'utilise pas cette colonne.
-- ============================================================================
BEGIN;

ALTER TABLE diagnosis ADD COLUMN IF NOT EXISTS root_cause_component_text TEXT;

UPDATE diagnosis d
SET root_cause_component_text = c.name
FROM component c
WHERE d.root_cause_component_id = c.component_id
  AND d.root_cause_component_text IS NULL;

COMMIT;
