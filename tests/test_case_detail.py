"""« Détaille le cas N » (case_detail_service) : aucun appel réseau ni base réelle."""

import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.models.catalog import Component
from app.models.device import DeviceModel, Manufacturer
from app.models.intervention import Intervention
from app.schemas.intervention_add_schema import SubmittedDiagnosis
from app.schemas.message_understanding_schema import UnderstoodMessage
from app.services import case_detail_service, chat_orchestrator_service as orchestrator

STORED_RESULT = {
    "position": 2,
    "kind": "case",
    "intervention_id": 3045,
    "matched_symptom_text": "La carte reste coincée dans le distributeur.",
    "matched_symptoms": [],
}


def fake_db(diagnosis):
    """Une intervention à 2 symptômes et 2 actions, sur un GAB NCR SelfServ 22."""
    symptoms = [
        SimpleNamespace(intervention_symptom_id=9004, raw_text="La carte reste coincée dans le distributeur.", severity="haute"),
        SimpleNamespace(intervention_symptom_id=9006, raw_text="L'imprimante de reçus est bloquée.", severity=None),
    ]
    actions = [
        SimpleNamespace(sequence_order=2, raw_text="Remplacé le capteur.", performed_at=None,
                        result_description="La carte ressort normalement.", outcome_status="resolved",
                        is_confirmed_solution=True, targets_symptom_id=9004),
        SimpleNamespace(sequence_order=1, raw_text="Nettoyé le lecteur.", performed_at=None,
                        result_description="Toujours bloquée.", outcome_status="no_effect",
                        is_confirmed_solution=False, targets_symptom_id=None),
    ]
    device = SimpleNamespace(device_type="gab", model_id=10, serial_number="SN-1", site_name="Agence 14", address=None)
    intervention = SimpleNamespace(
        device=device, symptoms=symptoms, actions=actions, ticket_reference="T-77",
        opened_at=datetime(2026, 9, 10, 14, 30), closed_at=None, final_outcome_status="resolved",
        summary_text="Capteur HS, remplacé.",
    )
    rows = {
        (Intervention, 3045): intervention,
        (DeviceModel, 10): SimpleNamespace(model_name="SelfServ 22", manufacturer_id=1),
        (Manufacturer, 1): SimpleNamespace(name="NCR"),
        (Component, 1): SimpleNamespace(name="Card reader"),
    }
    db = MagicMock()
    db.get.side_effect = lambda model, key: rows.get((model, key))
    db.query.return_value.filter.return_value.first.return_value = diagnosis
    return db


SUMMARY_CASE = {
    "technician_name": "Bob",
    "matched_symptom_text": STORED_RESULT["matched_symptom_text"],
    "matched_symptoms": [],
    # Dans l'ordre des actions (sequence_order), comme build_case.
    "actions": [{"proposed_by": None}, {"proposed_by": None}],
    "confidence": None,
}


def diagnosis(text=None, component_id=None):
    return SimpleNamespace(description="Capteur de rétention défaillant.", confirmed=True,
                           root_cause_component_text=text, root_cause_component_id=component_id)


class CaseDossierTests(unittest.TestCase):
    def build(self, diag):
        with patch.object(case_detail_service.case_retrieval_service, "build_case", return_value=SUMMARY_CASE):
            return case_detail_service.build_case_dossier(fake_db(diag), STORED_RESULT, "gab")

    def test_dossier_reads_all_the_description_tables(self):
        dossier = self.build(diagnosis(text="Capteur de rétention"))
        self.assertEqual(dossier["summary_text"], "Capteur HS, remplacé.")
        self.assertEqual(dossier["device"]["manufacturer"], "NCR")
        self.assertEqual([s["matched_search"] for s in dossier["symptoms"]], [True, False])
        self.assertEqual([a["result_description"] for a in dossier["actions"]],
                         ["Toujours bloquée.", "La carte ressort normalement."])
        self.assertEqual(dossier["actions"][1]["targets_symptom_number"], 1)
        self.assertEqual(dossier["root_cause_component"], "Capteur de rétention")

        text = case_detail_service._format_dossier(dossier)
        self.assertIn("GAB, NCR SelfServ 22", text)
        self.assertIn("C'EST CETTE ACTION QUI A RÉGLÉ LE PROBLÈME", text)
        self.assertIn("Cause identifiée (confirmée)", text)

    def test_root_cause_falls_back_to_the_catalog_then_to_nothing(self):
        self.assertEqual(self.build(diagnosis(component_id=1))["root_cause_component"], "Card reader")
        self.assertIsNone(self.build(diagnosis())["root_cause_component"])
        self.assertIsNone(self.build(None)["root_cause_component"])

    def test_deleted_case_gives_no_dossier(self):
        with patch.object(case_detail_service.case_retrieval_service, "build_case", return_value=None):
            self.assertIsNone(case_detail_service.build_case_dossier(MagicMock(), STORED_RESULT))


class DevelopCaseTests(unittest.TestCase):
    def develop(self, root_cause):
        dossier = {
            "technician_name": "Bob", "ticket_reference": None, "opened_at": None, "closed_at": None,
            "final_outcome_status": "resolved", "summary_text": None,
            "device": {"device_type": "gab", "model_name": None, "manufacturer": None,
                       "serial_number": None, "site_name": None, "address": None},
            "symptoms": [], "actions": [], "diagnosis": None, "diagnosis_confirmed": False,
            "root_cause_component": root_cause, "confidence": None,
        }
        with (
            patch.object(case_detail_service, "build_case_dossier", return_value=dossier),
            patch.object(case_detail_service.llm_service, "generate_reply", return_value="**Cas 2** …") as call,
        ):
            reply = case_detail_service.develop_case(MagicMock(), STORED_RESULT, "détaille le cas 2", "gab", "carte bloquée")
        return reply, call.call_args.args[0]

    def test_root_cause_from_the_database_must_be_cited(self):
        reply, prompt = self.develop("Capteur de rétention")
        self.assertEqual(reply, "**Cas 2** …")
        self.assertIn("La base de données indique que la pièce en cause est : « Capteur de rétention »", prompt)
        self.assertIn("« détaille le cas 2 »", prompt)

    def test_missing_root_cause_must_not_be_invented(self):
        _, prompt = self.develop(None)
        self.assertIn("ne précise pas la pièce en cause", prompt)


class DetailRoutingTests(unittest.TestCase):
    def route(self, understood, results):
        context = {"device_type": "gab", "last_search": {"query": "carte bloquée", "results": results}}
        with patch.object(orchestrator.case_detail_service, "develop_case", return_value="Dossier développé") as develop:
            reply = orchestrator._route_message(MagicMock(), context, "détaille le cas 2", understood)
        return reply, develop, context

    def test_detail_request_uses_the_full_dossier(self):
        understood = UnderstoodMessage(intent="conversation", result_position=2, case_detail_requested=True, reply="Voici.")
        reply, develop, context = self.route(understood, [STORED_RESULT])
        self.assertEqual(reply, "Dossier développé")
        self.assertEqual(develop.call_args.args[1], STORED_RESULT)
        self.assertEqual(develop.call_args.kwargs["problem_text"], "carte bloquée")
        self.assertEqual(context["selected_result"], STORED_RESULT)

    def test_other_questions_keep_the_understanding_reply(self):
        not_detail = UnderstoodMessage(intent="conversation", result_position=2, reply="Ok, essaie le cas 2.")
        reply, develop, _ = self.route(not_detail, [STORED_RESULT])
        self.assertEqual(reply, "Ok, essaie le cas 2.")
        develop.assert_not_called()

        stat = {"position": 2, "kind": "stat", "action_text": "Reset"}
        detail_on_stat = UnderstoodMessage(intent="conversation", result_position=2, case_detail_requested=True, reply="Stat.")
        self.assertEqual(self.route(detail_on_stat, [stat])[0], "Stat.")

    def test_missing_flag_from_the_llm_means_no_detail(self):
        self.assertFalse(UnderstoodMessage(intent="conversation", reply="x", case_detail_requested=None).case_detail_requested)


class RootCauseInFormTests(unittest.TestCase):
    def test_root_cause_is_free_text(self):
        submitted = SubmittedDiagnosis(description="Capteur HS", root_cause_component_text="Pièce jamais vue")
        self.assertEqual(submitted.root_cause_component_text, "Pièce jamais vue")


if __name__ == "__main__":
    unittest.main()
