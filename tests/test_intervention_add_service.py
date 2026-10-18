"""Ajout d'intervention : envoi, aperçu, correction et validation admin -- sans base ni réseau."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.errors import (
    AccessDeniedError,
    ExternalServiceUnavailableError,
    InvalidReferenceError,
    ReferenceNotFoundError,
    StateConflictError,
)
from app.main import app
from app.models.catalog import Action, Symptom
from app.models.conversation import Conversation
from app.models.device import Device, DeviceModel
from app.models.intervention import Diagnosis, Intervention, InterventionAction, InterventionSymptom
from app.models.intervention_add import InterventionAdd
from app.models.technician import Technician
from app.schemas.intervention_add_schema import (
    InterventionAddRequest,
    InterventionAddApproval,
    InterventionAddEdit,
    InterventionAddRejection,
    ReviewedInterventionContent,
)
from app.services import intervention_add_service as service

TECHNICIAN_ID = 4
OTHER_TECHNICIAN_ID = 8
# Appareil pas encore en base : sera créé à l'approbation.
NEW_DEVICE = {"serial_number": "TPE-77-001", "device_type": "TPE", "model_name": "Opteva 720", "site_name": "Agence Nord"}

# Clé primaire de chaque table simulée, et premier ID attribué par le « flush ».
PRIMARY_KEYS = {
    InterventionAdd: ("intervention_add_id", 100),
    Intervention: ("intervention_id", 5000),
    InterventionSymptom: ("intervention_symptom_id", 9100),
    InterventionAction: ("intervention_action_id", 7100),
    Diagnosis: ("diagnosis_id", 600),
    Device: ("device_id", 700),
    DeviceModel: ("model_id", 30),
    Symptom: ("symptom_id", 80),
    Action: ("action_id", 90),
}


class FakeQuery:
    """query(Model).filter(Model.colonne == valeur).limit(n).all() -- le seul usage du service."""

    def __init__(self, rows):
        self.rows = rows

    def filter(self, *conditions):
        rows = self.rows
        for condition in conditions:
            column, value = condition.left.key, condition.right.value
            rows = [row for row in rows if getattr(row, column, None) == value]
        return FakeQuery(rows)

    def limit(self, count):
        return FakeQuery(self.rows[:count])

    def all(self):
        return self.rows


class FakeSession:
    """Juste ce que le service utilise : get / query / add / flush / commit / rollback."""

    def __init__(self, objects):
        self.objects = dict(objects)
        self.added = []
        self.commits = 0
        self.rollbacks = 0
        self.next_ids = {model: first for model, (_, first) in PRIMARY_KEYS.items()}

    def get(self, model, key, with_for_update=False):
        return self.objects.get((model, key))

    def query(self, model):
        return FakeQuery([obj for (obj_model, _), obj in self.objects.items() if obj_model is model])

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        for obj in self.added:
            key_name, _ = PRIMARY_KEYS.get(type(obj), (None, None))
            if key_name and getattr(obj, key_name) is None:
                setattr(obj, key_name, self.next_ids[type(obj)])
                self.next_ids[type(obj)] += 1
                self.objects[(type(obj), getattr(obj, key_name))] = obj

    def commit(self):
        self.flush()
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def added_of(self, model):
        return [obj for obj in self.added if isinstance(obj, model)]


def build_session():
    return FakeSession({
        (Technician, TECHNICIAN_ID): SimpleNamespace(technician_id=TECHNICIAN_ID, full_name="Technicien Test API"),
        (Technician, OTHER_TECHNICIAN_ID): SimpleNamespace(technician_id=OTHER_TECHNICIAN_ID, full_name="Bob Nguyen"),
        (Device, 501): SimpleNamespace(device_id=501, device_type="gab", model_id=10, site_name="Branch 14, Main St",
                                       serial_number="ON-DN-88213", address=None),
        (DeviceModel, 10): SimpleNamespace(model_id=10, model_name="Opteva 720"),
        (Symptom, 21): SimpleNamespace(symptom_id=21, canonical_text="Carte retenue par le GAB"),
        (Action, 43): SimpleNamespace(action_id=43, canonical_text="Reinitialize card reader"),
        (Action, 44): SimpleNamespace(action_id=44, canonical_text="Replace card-retention sensor"),
        (Conversation, 15): SimpleNamespace(conversation_id=15, technician_id=OTHER_TECHNICIAN_ID),
    })


def intervention_add_payload(**overrides):
    """Une demande complète : 2 symptômes, 3 actions (la 3e règle le problème), une cause."""
    return {
        "technician_id": TECHNICIAN_ID,
        "device": {"device_id": 501},
        "final_outcome_status": "resolved",
        "symptoms": [
            {"text": "Le clavier ne répond plus après une carte insérée"},
            {"text": "Écran figé sur « Veuillez patienter »"},
        ],
        "actions": [
            {"text": "Redémarrage du GAB", "result_description": "Aucun changement", "outcome_status": "no_effect"},
            {"text": "Nettoyage du connecteur du clavier", "result_description": "Toujours bloqué", "outcome_status": "no_effect",
             "targets_symptom_number": 1},
            {"text": "Remplacement de la nappe du clavier", "result_description": "Clavier et écran OK",
             "outcome_status": "resolved", "is_confirmed_solution": True, "targets_symptom_number": 1},
        ],
        "diagnosis": {"description": "Nappe du clavier pincée", "confirmed": True},
        **overrides,
    }


def fake_embeddings(db, texts, device_type):
    """1er symptôme : proche du symptôme 21 du catalogue ; 2e : rien de proche."""
    matches = [{"symptom_id": 21, "distance": 0.08}, None]
    return [([0.1 * (index + 1)] * 3, matches[index % 2]) for index, _ in enumerate(texts)]


def fake_action_rankings(db, texts, limit=1):
    """« Redémarrage » ressemble à l'action 43 ; le reste n'a rien de proche."""
    near = {"Redémarrage du GAB": {"action_id": 43, "distance": 0.10}}
    return [[near[text]] if text in near else [{"action_id": 44, "distance": 0.6}] for text in texts]


class InterventionAddTestCase(unittest.TestCase):
    def setUp(self):
        self.db = build_session()
        self.stored_vectors = []
        patches = [
            patch.object(service.intervention_service, "embed_symptoms_and_match_catalog", side_effect=fake_embeddings),
            patch.object(service.catalog_service, "rank_catalog_actions", side_effect=fake_action_rankings),
            patch.object(service, "store_symptom_embedding",
                         side_effect=lambda db, symptom_id, vector: self.stored_vectors.append((symptom_id, vector))),
            patch.object(service.stats_service, "recompute_stats_safely"),
        ]
        self.mocks = [patcher.start() for patcher in patches]
        for patcher in patches:
            self.addCleanup(patcher.stop)

    def submit(self, **overrides):
        return service.submit_intervention_add(self.db, InterventionAddRequest(**intervention_add_payload(**overrides)))

    def approve(self, intervention_add_id):
        return service.approve_intervention_add(self.db, intervention_add_id, InterventionAddApproval(reviewed_by="Admin Saoul"))


class InterventionContentValidationTests(unittest.TestCase):
    def test_resolved_intervention_needs_a_confirmed_solution(self):
        payload = intervention_add_payload()
        payload["actions"][2]["is_confirmed_solution"] = False
        with self.assertRaisesRegex(ValidationError, "quelle action a réglé"):
            InterventionAddRequest(**payload)

    def test_confirmed_solution_must_be_resolved(self):
        payload = intervention_add_payload()
        payload["actions"][2]["outcome_status"] = "partial"
        with self.assertRaisesRegex(ValidationError, "outcome_status = resolved"):
            InterventionAddRequest(**payload)

    def test_confirmed_solution_implies_resolved_intervention(self):
        with self.assertRaisesRegex(ValidationError, "final_outcome_status doit valoir resolved"):
            InterventionAddRequest(**intervention_add_payload(final_outcome_status="unresolved"))

    def test_targeted_symptom_must_exist(self):
        payload = intervention_add_payload()
        payload["actions"][1]["targets_symptom_number"] = 3
        with self.assertRaisesRegex(ValidationError, "symptôme n° 3"):
            InterventionAddRequest(**payload)

    def test_device_is_required(self):
        with self.assertRaisesRegex(ValidationError, "Indiquez l'appareil"):
            InterventionAddRequest(**intervention_add_payload(device={}))

    def test_device_type_is_checked(self):
        with self.assertRaises(ValidationError):
            InterventionAddRequest(**intervention_add_payload(device={"device_type": "atm"}))

    def test_unresolved_intervention_without_solution_is_accepted(self):
        payload = intervention_add_payload(final_outcome_status="escalated")
        payload["actions"] = payload["actions"][:2]
        self.assertEqual(InterventionAddRequest(**payload).final_outcome_status, "escalated")


class SubmissionTests(InterventionAddTestCase):
    def test_request_is_pending_and_nothing_reaches_the_history(self):
        intervention_add = self.submit()
        self.assertEqual(intervention_add.status, "pending")
        self.assertEqual(intervention_add.content, intervention_add.submitted_content)
        self.assertEqual(intervention_add.content["device"]["device_id"], 501)
        self.assertEqual(intervention_add.content["device"]["model_name"], "Opteva 720")
        self.assertIsNotNone(intervention_add.content["opened_at"])
        self.assertEqual(self.db.added_of(Intervention), [])
        self.assertEqual(self.db.added_of(InterventionSymptom), [])
        self.mocks[0].assert_not_called()  # aucun embedding avant la validation

    def test_existing_device_is_found_by_type_model_and_site(self):
        with patch.object(service.technical_reference_resolver_service, "resolve_technical_references",
                          return_value={"model_id": 10}):
            intervention_add = self.submit(device={"device_type": "gab", "model_name": "opteva 720", "site_name": "Branch 14, Main St"})
        self.assertEqual(intervention_add.content["device"]["device_id"], 501)

    def test_site_name_ignores_case_and_spaces(self):
        with patch.object(service.technical_reference_resolver_service, "resolve_technical_references",
                          return_value={"model_id": 10}):
            intervention_add = self.submit(device={"device_type": "gab", "model_name": "Opteva 720", "site_name": "  branch 14,  main st "})
        self.assertEqual(intervention_add.content["device"]["device_id"], 501)

    def test_same_type_and_model_on_another_site_is_a_new_device(self):
        with patch.object(service.technical_reference_resolver_service, "resolve_technical_references",
                          return_value={"model_id": 10}):
            intervention_add = self.submit(device={"device_type": "gab", "model_name": "Opteva 720", "site_name": "Agence Sud"})
        self.assertIsNone(intervention_add.content["device"]["device_id"])

    def test_existing_device_is_found_by_serial_number(self):
        intervention_add = self.submit(device={"serial_number": "ON-DN-88213", "device_type": "gab"})
        self.assertEqual(intervention_add.content["device"]["device_id"], 501)

    def test_unknown_device_is_described_for_creation(self):
        with patch.object(service.technical_reference_resolver_service, "resolve_technical_references",
                          return_value={"model_id": 10, "model_name": "opteva 720"}):
            intervention_add = self.submit(device=NEW_DEVICE)
        device = intervention_add.content["device"]
        self.assertEqual((device["device_id"], device["model_id"], device["device_type"]), (None, 10, "tpe"))
        self.assertEqual(self.db.added_of(Device), [])  # créé seulement à l'approbation
        self.assertTrue(service.describe_intervention_add(self.db, intervention_add)["device_label"].endswith("(nouvel appareil)"))

    def test_unknown_device_without_type_is_refused(self):
        with self.assertRaisesRegex(InvalidReferenceError, "précisez device_type"):
            self.submit(device={"serial_number": "INCONNU-1"})

    def test_device_type_must_match_the_existing_device(self):
        with self.assertRaisesRegex(InvalidReferenceError, "est un GAB, pas un TPE"):
            self.submit(device={"device_id": 501, "device_type": "tpe"})

    def test_unknown_technician_or_device_is_refused(self):
        with self.assertRaises(ReferenceNotFoundError):
            self.submit(technician_id=999)
        with self.assertRaises(ReferenceNotFoundError):
            self.submit(device={"device_id": 999})

    def test_conversation_of_another_technician_is_refused(self):
        with self.assertRaises(AccessDeniedError):
            self.submit(conversation_id=15)

    def test_technician_cannot_read_another_request(self):
        intervention_add = self.submit()
        with self.assertRaises(AccessDeniedError):
            service.get_intervention_add_for_technician(self.db, intervention_add.intervention_add_id, OTHER_TECHNICIAN_ID)


class PreviewTests(InterventionAddTestCase):
    def test_preview_shows_each_row_and_its_catalog_link(self):
        intervention_add = self.submit()
        added_before = len(self.db.added)
        preview = service.preview_intervention_add(self.db, intervention_add.intervention_add_id)

        self.assertEqual(len(self.db.added), added_before)  # l'aperçu n'écrit rien
        self.assertEqual(preview.intervention.device_id, 501)
        self.assertEqual(
            [(s.catalog_link, s.symptom_id) for s in preview.intervention_symptom],
            [("matched_existing", 21), ("new_catalog_entry", None)],
        )
        self.assertEqual(
            [(a.sequence_order, a.catalog_link, a.action_id) for a in preview.intervention_action],
            [(1, "matched_existing", 43), (2, "new_catalog_entry", None), (3, "new_catalog_entry", None)],
        )
        self.assertEqual(preview.new_catalog_symptoms, ["Écran figé sur « Veuillez patienter »"])
        self.assertEqual(preview.diagnosis.description, "Nappe du clavier pincée")

    def test_admin_choice_wins_over_automatic_matching(self):
        intervention_add = self.submit()
        content = ReviewedInterventionContent.model_validate(intervention_add.content)
        content.symptoms[1].catalog_symptom_id = 21
        content.actions[2].catalog_action_id = 44
        service.update_intervention_add(self.db, intervention_add.intervention_add_id, InterventionAddEdit(edited_by="Admin Saoul", content=content))

        preview = service.preview_intervention_add(self.db, intervention_add.intervention_add_id)
        self.assertEqual(preview.intervention_symptom[1].catalog_link, "chosen_by_admin")
        self.assertEqual(preview.intervention_action[2].action_id, 44)
        self.assertEqual(preview.new_catalog_symptoms, [])


class EditTests(InterventionAddTestCase):
    def test_edit_keeps_the_original_submission(self):
        intervention_add = self.submit()
        content = ReviewedInterventionContent.model_validate(intervention_add.content)
        content.symptoms[0].text = "Clavier inactif après insertion de la carte"
        service.update_intervention_add(self.db, intervention_add.intervention_add_id, InterventionAddEdit(edited_by="Admin Saoul", content=content))

        described = service.describe_intervention_add(self.db, intervention_add)
        self.assertTrue(described["edited_by_admin"])
        self.assertEqual(described["last_edited_by"], "Admin Saoul")
        self.assertEqual(intervention_add.submitted_content["symptoms"][0]["text"], "Le clavier ne répond plus après une carte insérée")

    def test_edit_with_unknown_catalog_entry_is_refused(self):
        intervention_add = self.submit()
        content = ReviewedInterventionContent.model_validate(intervention_add.content)
        content.actions[0].catalog_action_id = 999
        with self.assertRaises(ReferenceNotFoundError):
            service.update_intervention_add(self.db, intervention_add.intervention_add_id, InterventionAddEdit(edited_by="Admin Saoul", content=content))


class ApprovalTests(InterventionAddTestCase):
    def test_approval_writes_every_table(self):
        intervention_add = self.submit()
        intervention_add, preview, written = self.approve(intervention_add.intervention_add_id)

        intervention = self.db.added_of(Intervention)[0]
        self.assertEqual((intervention.device_id, intervention.technician_id, intervention.final_outcome_status), (501, 4, "resolved"))

        symptoms = self.db.added_of(InterventionSymptom)
        self.assertEqual([s.intervention_id for s in symptoms], [written.intervention_id] * 2)
        self.assertEqual(symptoms[0].symptom_id, 21)
        new_catalog_symptom = self.db.added_of(Symptom)[0]
        self.assertEqual(symptoms[1].symptom_id, new_catalog_symptom.symptom_id)
        self.assertEqual([symptom_id for symptom_id, _ in self.stored_vectors], written.intervention_symptom_ids)

        actions = self.db.added_of(InterventionAction)
        self.assertEqual([a.sequence_order for a in actions], [1, 2, 3])
        self.assertEqual([a.is_confirmed_solution for a in actions], [False, False, True])
        # « symptôme n° 1 » devient l'ID réel du premier intervention_symptom.
        self.assertEqual([a.targets_symptom_id for a in actions], [None, symptoms[0].intervention_symptom_id, symptoms[0].intervention_symptom_id])
        self.assertEqual(actions[0].action_id, 43)
        self.assertEqual(len(self.db.added_of(Action)), 2)  # deux nouvelles actions au catalogue

        self.assertEqual(self.db.added_of(Diagnosis)[0].intervention_id, written.intervention_id)
        self.assertEqual((intervention_add.status, intervention_add.created_intervention_id), ("approved", written.intervention_id))
        self.mocks[3].assert_called_once()  # statistiques recalculées

    def test_new_device_is_created_before_the_intervention(self):
        with patch.object(service.technical_reference_resolver_service, "resolve_technical_references",
                          return_value={"model_id": 10}):
            intervention_add = self.submit(device=NEW_DEVICE)
            _, preview, written = self.approve(intervention_add.intervention_add_id)

        device = self.db.added_of(Device)[0]
        self.assertEqual((device.device_type, device.serial_number, device.model_id), ("tpe", "TPE-77-001", 10))
        self.assertEqual(self.db.added_of(Intervention)[0].device_id, device.device_id)
        self.assertEqual(self.db.added_of(DeviceModel), [])  # modèle connu : pas de doublon
        self.assertTrue(written.created_device)
        self.assertEqual(preview.device.device_id, device.device_id)

    def test_unknown_model_is_created_with_the_device(self):
        with patch.object(service.technical_reference_resolver_service, "resolve_technical_references", return_value={}):
            intervention_add = self.submit(device={**NEW_DEVICE, "model_name": "Ingenico Move 5000"})
            preview = service.preview_intervention_add(self.db, intervention_add.intervention_add_id)
            self.assertTrue(preview.device.is_new_model)
            _, _, written = self.approve(intervention_add.intervention_add_id)

        model = self.db.added_of(DeviceModel)[0]
        self.assertEqual(model.model_name, "Ingenico Move 5000")
        self.assertEqual(self.db.added_of(Device)[0].model_id, model.model_id)
        self.assertTrue(written.created_model)

    def test_device_created_meanwhile_is_reused(self):
        with patch.object(service.technical_reference_resolver_service, "resolve_technical_references", return_value={}):
            intervention_add = self.submit(device=NEW_DEVICE)
            # Entre l'envoi et la validation, un appareil avec ce numéro a été ajouté.
            self.db.objects[(Device, 650)] = SimpleNamespace(device_id=650, device_type="tpe", model_id=None,
                                                             site_name=None, serial_number="TPE-77-001", address=None)
            _, preview, written = self.approve(intervention_add.intervention_add_id)
        self.assertEqual(self.db.added_of(Device), [])
        self.assertEqual(self.db.added_of(DeviceModel), [])  # appareil existant : son modèle ne change pas
        self.assertEqual((written.device_id, written.created_device), (650, False))

    def test_action_date_is_written(self):
        payload = intervention_add_payload()
        payload["actions"][0]["performed_at"] = "2026-10-12T09:30:00"
        intervention_add = service.submit_intervention_add(self.db, InterventionAddRequest(**payload))
        self.approve(intervention_add.intervention_add_id)
        self.assertEqual(self.db.added_of(InterventionAction)[0].performed_at.hour, 9)

    def test_same_new_text_creates_one_catalog_entry(self):
        payload = intervention_add_payload()
        payload["actions"][1]["text"] = "Remplacement de la nappe du clavier"
        intervention_add = service.submit_intervention_add(self.db, InterventionAddRequest(**payload))
        _, preview, _ = self.approve(intervention_add.intervention_add_id)
        self.assertEqual(len(self.db.added_of(Action)), 1)
        self.assertEqual(preview.intervention_action[1].action_id, preview.intervention_action[2].action_id)

    def test_decision_is_final(self):
        intervention_add = self.submit()
        self.approve(intervention_add.intervention_add_id)
        with self.assertRaises(StateConflictError):
            self.approve(intervention_add.intervention_add_id)
        with self.assertRaises(StateConflictError):
            service.reject_intervention_add(self.db, intervention_add.intervention_add_id, InterventionAddRejection(reviewed_by="Admin", admin_comment="Doublon"))

    def test_embedding_failure_writes_nothing(self):
        intervention_add = self.submit()
        self.mocks[0].side_effect = ExternalServiceUnavailableError("Voyage indisponible")
        with self.assertRaises(ExternalServiceUnavailableError):
            self.approve(intervention_add.intervention_add_id)
        self.assertEqual(self.db.added_of(Intervention), [])
        self.assertEqual(intervention_add.status, "pending")

    def test_rejection_keeps_the_request_and_writes_nothing(self):
        intervention_add = self.submit()
        service.reject_intervention_add(self.db, intervention_add.intervention_add_id, InterventionAddRejection(reviewed_by="Admin", admin_comment="Doublon de 3001"))
        self.assertEqual((intervention_add.status, intervention_add.admin_comment), ("rejected", "Doublon de 3001"))
        self.assertEqual(self.db.added_of(Intervention), [])

    def test_rejection_needs_a_comment(self):
        with self.assertRaises(ValidationError):
            InterventionAddRejection(reviewed_by="Admin", admin_comment="  ")


class RouteProtectionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_admin_routes_need_the_admin_key(self):
        with patch.object(service.settings, "admin_api_key", "secret"):
            self.assertEqual(self.client.get("/api/admin/intervention_add").status_code, 403)
            response = self.client.post("/api/admin/intervention_add/1/approve", json={"reviewed_by": "X"})
            self.assertEqual(response.status_code, 403)

    def test_direct_history_writes_are_admin_only(self):
        with patch.object(service.settings, "admin_api_key", "secret"):
            response = self.client.post("/interventions", json={"device_id": 501, "technician_id": 4, "symptoms": [{"raw_text": "x"}]})
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
