BEGIN;

ALTER TABLE code_erreur ADD COLUMN catalog_number INTEGER;
UPDATE code_erreur SET catalog_number = error_code_id;
ALTER TABLE code_erreur ALTER COLUMN catalog_number SET NOT NULL;
ALTER TABLE code_erreur ADD CONSTRAINT code_erreur_catalog_number_unique UNIQUE (catalog_number);
ALTER TABLE code_erreur ADD CONSTRAINT code_erreur_catalog_number_positive CHECK (catalog_number > 0);

DO $$
DECLARE
    sequence_name TEXT := pg_get_serial_sequence('code_erreur', 'error_code_id');
BEGIN
    EXECUTE format('ALTER TABLE code_erreur ALTER COLUMN error_code_id SET DEFAULT nextval(%L)', sequence_name);
    PERFORM setval(sequence_name::regclass, COALESCE((SELECT MAX(error_code_id) FROM code_erreur), 0) + 1, false);
END $$;

ALTER TABLE message_conversation ADD COLUMN detected_error_code TEXT;
ALTER TABLE message_conversation ADD COLUMN error_code_id INTEGER
    REFERENCES code_erreur(error_code_id) ON DELETE SET NULL;
CREATE INDEX idx_message_conversation_error_code ON message_conversation(error_code_id)
    WHERE error_code_id IS NOT NULL;

COMMIT;
