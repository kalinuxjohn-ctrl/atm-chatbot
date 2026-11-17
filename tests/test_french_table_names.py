"""Only SQL table names change; model attributes and API keys stay unchanged."""

from pathlib import Path
import re
import unittest

import app.models
from app.core.database import Base
from app.models.catalog import Symptom
from app.models.device import Device
from app.models.technician import Technician


PUBLIC_TABLES = {
    "technician": "technicien",
    "manufacturer": "fabricant",
    "device_model": "modele_appareil",
    "device_model_version": "version_modele_appareil",
    "device": "appareil",
    "component": "composant",
    "symptom": "symptome",
    "intervention_symptom": "symptome_intervention",
    "intervention_action": "action_intervention",
    "diagnosis": "diagnostic",
    "symptom_action_outcome_stats": "statistiques_resultats_symptome_action",
    "conversation_message": "message_conversation",
    "conversation_context": "contexte_conversation",
    "fault": "panne",
    "error_code": "code_erreur",
    "solution_proposal": "proposition_solution",
    "usual_problem": "panne_frequente",
    "intervention_add": "ajout_intervention",
}
MAIN_APP_TABLES = {
    "accounts": "comptes",
    "login_throttles": "blocages_connexion",
    "map_points": "points_carte",
    "conversation_participants": "participants_conversation",
    "message_attachments": "pieces_jointes_message",
    "call_logs": "journal_appels",
}
ROOT = Path(__file__).resolve().parents[1]


class FrenchTableNamesTests(unittest.TestCase):
    def test_all_python_models_use_french_tables(self):
        expected = set(PUBLIC_TABLES.values()) | {"intervention", "action", "conversation"}
        self.assertEqual(set(Base.metadata.tables), expected)

    def test_foreign_keys_resolve_without_changing_column_names(self):
        for table in Base.metadata.tables.values():
            for foreign_key in table.foreign_keys:
                self.assertIn(foreign_key.column.table.name, Base.metadata.tables)
        self.assertEqual(Technician.technician_id.key, "technician_id")
        self.assertEqual(Device.device_id.key, "device_id")
        self.assertEqual(Symptom.symptom_id.key, "symptom_id")

    def test_forward_and_rollback_rename_exactly_the_same_tables(self):
        migration = (ROOT / "db/migrations/0019_table_names_french.sql").read_text()
        rollback = (ROOT / "db/rollback/0019_table_names_french.sql").read_text()
        expected = {
            (schema, old, new)
            for schema, mapping in [("public", PUBLIC_TABLES), ("main_app", MAIN_APP_TABLES)]
            for old, new in mapping.items()
        }
        pattern = r"ALTER TABLE (\w+)\.(\w+) RENAME TO (\w+);"
        self.assertEqual(set(re.findall(pattern, migration)), expected)
        self.assertEqual(set(re.findall(pattern, rollback)), {(schema, new, old) for schema, old, new in expected})
        self.assertTrue(migration.strip().endswith("COMMIT;"))
        self.assertNotRegex(migration, r"\b(?:DROP|TRUNCATE|DELETE|CREATE TABLE)\b")

    def test_main_app_setup_checks_french_table_names(self):
        setup = (ROOT / "main-app/src/jobs/configureDatabaseRole.js").read_text()
        names = re.search(r"EXPECTED_MAIN_APP_TABLES = \[(.*?)\];", setup, re.S).group(1)
        self.assertEqual(set(re.findall(r'"(\w+)"', names)), set(MAIN_APP_TABLES.values()) | {"sessions", "conversations", "messages"})


if __name__ == "__main__":
    unittest.main()
