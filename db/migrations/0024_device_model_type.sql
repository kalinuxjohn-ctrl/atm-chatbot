-- Distingue les modèles du catalogue selon leur famille d'équipement.
ALTER TABLE modele_appareil
    ADD COLUMN IF NOT EXISTS device_type device_type;

-- Récupère le type lorsque tous les appareils connus de ce modèle sont du même type.
WITH model_device_types AS (
    SELECT model_id, MIN(device_type::TEXT)::public.device_type AS device_type
    FROM appareil
    WHERE model_id IS NOT NULL
    GROUP BY model_id
    HAVING COUNT(DISTINCT device_type) = 1
)
UPDATE modele_appareil AS model
SET device_type = model_device_types.device_type
FROM model_device_types
WHERE model.model_id = model_device_types.model_id
  AND model.device_type IS NULL;
