-- Classe les actions par équipement ; NULL désigne une action commune GAB/TPE.
ALTER TABLE action
    ADD COLUMN IF NOT EXISTS device_type device_type;
