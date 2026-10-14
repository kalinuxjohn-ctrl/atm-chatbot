"""Propositions de solution : contexte, création, validation admin -- sans base ni réseau."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes import admin as admin_routes
from app.core.errors import AccessDeniedError, InvalidReferenceError, ReferenceNotFoundError, StateConflictError
from app.models.catalog import Action, Component, Symptom
from app.models.conversation import Conversation
from app.models.device import DeviceModel
from app.models.fault import ErrorCode
from app.models.intervention import Intervention, InterventionAction
from app.models.solution_proposal import SolutionProposal
from app.models.technician import Technician
from app.schemas.solution_proposal_schema import ProposalApproval, ProposalRejection, SolutionProposalCreate
from app.services import chat_orchestrator_service as orchestrator
from app.services import solution_proposal_service as service

TECHNICIAN_ID = 7
CONVERSATION_ID = 25


class FakeSession:
    """Juste ce que le service utilise : get / add / flush / commit / rollback."""

    def __init__(self, objects):
        self.objects = dict(objects)
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def get(self, model, key):
        return self.objects.get((model, key))

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        for obj in self.added:
            if isinstance(obj, SolutionProposal) and obj.proposal_id is None:
                obj.proposal_id = 900 + self.added.index(obj)
                self.objects[(SolutionProposal, obj.proposal_id)] = obj
            if isinstance(obj, InterventionAction) and obj.intervention_action_id is None:
                obj.intervention_action_id = 7000 + self.added.index(obj)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def build_world():
    """Deux cas passés trouvés par la recherche ; le technicien a approfondi le deuxième."""
    gab = SimpleNamespace(device_id=501, device_type="gab")
    symptom_391 = SimpleNamespace(intervention_symptom_id=391, symptom_id=37, raw_text="La carte n'est pas détectée.")
    other_symptom = SimpleNamespace(intervention_symptom_id=392, symptom_id=None, raw_text="Écran figé.")
    actions_148 = [
        SimpleNamespace(sequence_order=1, raw_text="Nettoyer le lecteur", is_confirmed_solution=False),
        SimpleNamespace(sequence_order=2, raw_text="Remplacer la tête de lecture", is_confirmed_solution=True),
    ]
    intervention_148 = SimpleNamespace(
        intervention_id=148, device=gab, symptoms=[other_symptom, symptom_391], actions=actions_148
    )
    intervention_300 = SimpleNamespace(
        intervention_id=300,
        device=gab,
        symptoms=[SimpleNamespace(intervention_symptom_id=827, symptom_id=37, raw_text="Carte non lue.")],
        actions=[SimpleNamespace(sequence_order=1, raw_text="Réinitialiser le lecteur", is_confirmed_solution=True)],
    )
    objects = {
        (Conversation, CONVERSATION_ID): SimpleNamespace(conversation_id=CONVERSATION_ID, technician_id=TECHNICIAN_ID),
        (Intervention, 148): intervention_148,
        (Intervention, 300): intervention_300,
        (Symptom, 37): SimpleNamespace(symptom_id=37, canonical_text="Lecteur de carte — carte non détectée", component_id=4),
        (Component, 4): SimpleNamespace(component_id=4, name="Lecteur de carte"),
        (DeviceModel, 12): SimpleNamespace(model_id=12, model_name="MX5600"),
        (ErrorCode, 1): SimpleNamespace(error_code_id=1, code="E42"),
        (Technician, TECHNICIAN_ID): SimpleNamespace(technician_id=TECHNICIAN_ID, full_name="Alan"),
        (Action, 55): SimpleNamespace(action_id=55, canonical_text="Remplacer le capteur"),
    }
    context = {
        "intent": "diagnostic",
        "device_type": "gab",
        "model_id": 12,
        "model_name": "MX5600",
        "error_code_id": 1,
        "error_code": "E42",
        "last_search": {
            "query": "carte non détectée par le lecteur",
            "results": [
                {"position": 1, "kind": "case", "intervention_id": 300,
                 "matched_symptom_text": "Carte non lue.", "matched_intervention_symptom_id": 827},
                {"position": 2, "kind": "case", "intervention_id": 148,
                 "matched_symptom_text": "La carte n'est pas détectée.", "matched_intervention_symptom_id": 391},
            ],
        },
        "selected_result": {"position": 2, "kind": "case", "intervention_id": 148},
    }
    return FakeSession(objects), context


class ProposalTestCase(unittest.TestCase):
    def setUp(self):
        self.db, self.context = build_world()
        self.saved_contexts = []
        self.saved_messages = []
        patches = [
            patch.object(service.context_service, "get_context", side_effect=lambda db, cid: self.context),
            patch.object(service.context_service, "save_context",
                         side_effect=lambda db, cid, ctx: self.saved_contexts.append((cid, ctx))),
            patch.object(service.conversation_service, "save_message",
                         side_effect=lambda db, cid, role, content: self.saved_messages.append((cid, role, content))),
            patch.object(service.conversation_service, "mark_conversation_active"),
            patch.object(service.conversation_service, "get_recent_messages",
                         return_value=[SimpleNamespace(message_id=1), SimpleNamespace(message_id=2)]),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def create(self, **overrides):
        payload = {
            "technician_id": TECHNICIAN_ID,
            "proposed_action": "Remplacer le capteur de présence carte",
            "result_description": "La carte est de nouveau détectée, transaction de test OK.",
            **overrides,
        }
        return service.create_proposal(self.db, CONVERSATION_ID, SolutionProposalCreate(**payload))


class ContextRetrievalTests(ProposalTestCase):
    def test_context_is_resolved_from_the_selected_result(self):  # 1
        result = service.get_proposal_context(self.db, CONVERSATION_ID, TECHNICIAN_ID)
        self.assertEqual(result["conversation_id"], CONVERSATION_ID)
        self.assertEqual(result["context"], {
            "intervention_id": 148, "intervention_symptom_id": 391, "symptom_id": 37, "component_id": 4,
            "device_id": None, "device_type": "gab", "model_id": 12, "error_code_id": 1,
        })
        self.assertEqual(result["problem"]["label"], "Lecteur de carte — carte non détectée")
        self.assertEqual(result["problem"]["component_name"], "Lecteur de carte")
        self.assertEqual(result["problem"]["device_label"], "GAB · MX5600")
        self.assertEqual(result["problem"]["error_code"], "E42")
        self.assertEqual(result["reference_position"], 2)
        self.assertEqual(
            [(r["position"], r["intervention_symptom_id"], r["solution_text"]) for r in result["previous_results"]],
            [(1, 827, "Réinitialiser le lecteur"), (2, 391, "Remplacer la tête de lecture")],
        )

    def test_best_result_is_the_reference_without_selection(self):
        self.context.pop("selected_result")
        result = service.get_proposal_context(self.db, CONVERSATION_ID, TECHNICIAN_ID)
        self.assertEqual(result["context"]["intervention_symptom_id"], 827)
        self.assertEqual(result["reference_position"], 1)

    def test_older_contexts_without_symptom_id_fall_back_on_the_text(self):  # 4 (ancien format)
        for result in self.context["last_search"]["results"]:
            result.pop("matched_intervention_symptom_id")
        result = service.get_proposal_context(self.db, CONVERSATION_ID, TECHNICIAN_ID)
        self.assertEqual(result["context"]["intervention_symptom_id"], 391)

    def test_no_identified_problem_is_refused(self):  # 2
        for context in ({}, {"device_type": "gab"}, {"device_type": "gab", "last_search": {"query": "  ", "results": []}}):
            with self.subTest(context=context):
                self.context = context
                with self.assertRaises(StateConflictError):
                    service.get_proposal_context(self.db, CONVERSATION_ID, TECHNICIAN_ID)
                with self.assertRaises(StateConflictError):
                    self.create()
        self.assertEqual(self.db.added, [])

    def test_search_without_results_still_allows_a_proposal(self):
        self.context["last_search"]["results"] = []
        self.context.pop("selected_result")
        result = service.get_proposal_context(self.db, CONVERSATION_ID, TECHNICIAN_ID)
        self.assertIsNone(result["context"]["intervention_id"])
        self.assertEqual(result["problem"]["label"], "carte non détectée par le lecteur")

    def test_conversation_must_exist_and_belong_to_the_technician(self):
        with self.assertRaises(ReferenceNotFoundError):
            service.get_proposal_context(self.db, 999, TECHNICIAN_ID)
        with self.assertRaises(AccessDeniedError):
            service.get_proposal_context(self.db, CONVERSATION_ID, 8)

    def test_reference_case_must_still_exist_and_match_the_device_type(self):
        del self.db.objects[(Intervention, 148)]
        with self.assertRaises(StateConflictError):
            service.get_proposal_context(self.db, CONVERSATION_ID, TECHNICIAN_ID)
        self.db, _ = build_world()
        self.context["device_type"] = "tpe"
        with self.assertRaises(InvalidReferenceError):
            service.get_proposal_context(self.db, CONVERSATION_ID, TECHNICIAN_ID)


class CreationTests(ProposalTestCase):
    def test_proposal_is_created_pending_and_linked_to_the_active_problem(self):  # 3, 4, 5, 7
        proposal = self.create()
        self.assertIn(proposal, self.db.added)
        self.assertEqual(proposal.status, "pending")
        self.assertEqual(proposal.conversation_id, CONVERSATION_ID)
        self.assertEqual(proposal.technician_id, TECHNICIAN_ID)
        self.assertEqual((proposal.intervention_id, proposal.intervention_symptom_id), (148, 391))
        self.assertEqual((proposal.symptom_id, proposal.component_id), (37, 4))
        self.assertEqual((proposal.device_type, proposal.model_id, proposal.error_code_id), ("gab", 12, 1))
        self.assertEqual(proposal.problem_text, "carte non détectée par le lecteur")
        self.assertEqual(proposal.outcome_status, "resolved")
        self.assertIsNone(proposal.reviewed_at)
        self.assertEqual(self.db.commits, 1)

    def test_identifiers_sent_by_the_frontend_are_ignored(self):
        proposal = self.create(intervention_id=1, intervention_symptom_id=2, component_id=3, conversation_id=4)
        self.assertEqual((proposal.intervention_id, proposal.intervention_symptom_id, proposal.component_id), (148, 391, 4))
        self.assertEqual(proposal.conversation_id, CONVERSATION_ID)

    def test_snapshot_keeps_the_context_without_copying_the_conversation(self):  # 6
        snapshot = self.create().conversation_context_snapshot
        self.assertEqual(snapshot["last_search"], self.context["last_search"])
        self.assertEqual(snapshot["selected_result"]["position"], 2)
        self.assertEqual(snapshot["reference"]["intervention_symptom_id"], 391)
        self.assertEqual(snapshot["reference_position"], 2)
        self.assertEqual(len(snapshot["previous_results"]), 2)
        self.assertEqual(snapshot["recent_message_ids"], [1, 2])
        self.assertNotIn("messages", snapshot)

    def test_conversation_stays_usable_after_the_proposal(self):  # 15
        proposal = self.create()
        self.assertEqual(self.saved_messages, [(CONVERSATION_ID, "assistant", service.PROPOSAL_RECORDED_REPLY)])
        saved_id, saved_context = self.saved_contexts[-1]
        self.assertEqual(saved_id, CONVERSATION_ID)
        self.assertEqual(saved_context["last_solution_proposal"], {"proposal_id": proposal.proposal_id, "status": "pending"})
        self.assertIn("last_search", saved_context)  # « détaille le deuxième » fonctionne encore

    def test_another_technician_cannot_propose_in_this_conversation(self):
        with self.assertRaises(AccessDeniedError):
            self.create(technician_id=8)
        self.assertEqual(self.db.added, [])


class ReviewTests(ProposalTestCase):
    def setUp(self):
        super().setUp()
        self.proposal = self.create()
        self.db.commits = 0
        self.find_similar = patch.object(service.catalog_service, "find_similar_actions", return_value=[]).start()
        self.create_action = patch.object(
            service.catalog_service, "create_action_in_catalog", return_value=SimpleNamespace(action_id=77)
        ).start()
        self.recompute_stats = patch.object(service.stats_service, "recompute_stats_safely", return_value=True).start()
        self.addCleanup(patch.stopall)

    def attached_actions(self):
        return [obj for obj in self.db.added if isinstance(obj, InterventionAction)]

    def test_approval_creates_a_catalog_action(self):  # 8
        proposal, integration, _ = service.approve_proposal(
            self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="Mme Admin", admin_comment="Validé")
        )
        self.assertEqual(integration, "action_created")
        self.assertEqual(proposal.status, "approved")
        self.assertEqual(proposal.reviewed_by, "Mme Admin")
        self.assertIsNotNone(proposal.reviewed_at)
        self.assertEqual(proposal.admin_comment, "Validé")
        self.assertEqual(proposal.approved_action_id, 77)
        self.create_action.assert_called_once_with(self.db, "Remplacer le capteur de présence carte", 4)
        self.assertEqual(self.db.commits, 1)

    def test_equivalent_action_is_reused_instead_of_duplicated(self):  # 12
        self.find_similar.return_value = [{"action_id": 55, "canonical_text": "Remplacer le capteur", "distance": 0.05}]
        proposal, integration, _ = service.approve_proposal(
            self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="Mme Admin")
        )
        self.assertEqual(integration, "existing_action_reused")
        self.assertEqual(proposal.approved_action_id, 55)
        self.create_action.assert_not_called()

    def test_distant_action_does_not_prevent_creation(self):
        self.find_similar.return_value = [{"action_id": 55, "canonical_text": "Changer la batterie", "distance": 0.6}]
        _, integration, _ = service.approve_proposal(self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="A"))
        self.assertEqual(integration, "action_created")

    def test_admin_can_link_an_existing_action_and_rename_it(self):
        _, integration, _ = service.approve_proposal(
            self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="A", existing_action_id=55)
        )
        self.assertEqual(integration, "existing_action_linked")
        self.find_similar.assert_not_called()
        with self.assertRaises(ReferenceNotFoundError):
            other = self.create()
            service.approve_proposal(self.db, other.proposal_id, ProposalApproval(reviewed_by="A", existing_action_id=999))

    def test_canonical_text_is_used_for_the_catalog(self):
        service.approve_proposal(
            self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="A", canonical_text="Remplacer le capteur carte")
        )
        self.find_similar.assert_called_once_with(self.db, "Remplacer le capteur carte", limit=1)
        self.create_action.assert_called_once_with(self.db, "Remplacer le capteur carte", 4)

    def test_failed_duplicate_check_creates_nothing(self):
        self.find_similar.side_effect = RuntimeError("embedding indisponible")
        with self.assertRaises(RuntimeError):
            service.approve_proposal(self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="A"))
        self.create_action.assert_not_called()
        self.assertEqual(self.db.rollbacks, 1)
        self.assertEqual(self.proposal.status, "pending")

    def test_approval_attaches_the_solution_to_the_existing_problem(self):
        _, _, attached = service.approve_proposal(self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="A"))
        self.assertEqual(self.attached_actions(), [attached])
        self.assertEqual(attached.intervention_id, 148)
        self.assertEqual(attached.targets_symptom_id, 391)  # le symptôme déjà vectorisé : rien à recalculer
        self.assertEqual(attached.action_id, 77)
        self.assertEqual(attached.source_proposal_id, self.proposal.proposal_id)
        self.assertEqual(attached.sequence_order, 3)  # après les 2 actions de la visite d'origine
        self.assertEqual(attached.raw_text, self.proposal.proposed_action)
        self.assertEqual(attached.result_description, self.proposal.result_description)
        self.assertTrue(attached.is_confirmed_solution)
        self.recompute_stats.assert_called_once_with(self.db)

    def test_partial_fix_is_attached_but_not_counted_as_a_success(self):
        partial = self.create(outcome_status="partial")
        _, _, attached = service.approve_proposal(self.db, partial.proposal_id, ProposalApproval(reviewed_by="A"))
        self.assertEqual(attached.outcome_status, "partial")
        self.assertFalse(attached.is_confirmed_solution)

    def test_reused_catalog_action_is_attached_too(self):
        self.find_similar.return_value = [{"action_id": 55, "canonical_text": "Remplacer le capteur", "distance": 0.05}]
        _, _, attached = service.approve_proposal(self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="A"))
        self.assertEqual(attached.action_id, 55)

    def test_proposal_without_reference_case_stays_in_the_catalog_only(self):
        self.proposal.intervention_id = None
        self.proposal.intervention_symptom_id = None
        proposal, integration, attached = service.approve_proposal(
            self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="A")
        )
        self.assertIsNone(attached)
        self.assertEqual(self.attached_actions(), [])
        self.assertEqual((proposal.status, integration), ("approved", "action_created"))
        self.recompute_stats.assert_not_called()

    def test_symptom_from_another_intervention_is_never_attached(self):
        self.proposal.intervention_symptom_id = 827  # appartient à l'intervention 300, pas à 148
        _, _, attached = service.approve_proposal(self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="A"))
        self.assertIsNone(attached)

    def test_rejection_is_never_attached(self):
        service.reject_proposal(self.db, self.proposal.proposal_id, ProposalRejection(reviewed_by="A", admin_comment="Non"))
        self.assertEqual(self.attached_actions(), [])

    def test_rejection_keeps_the_proposal_out_of_the_catalog(self):  # 9
        proposal = service.reject_proposal(
            self.db, self.proposal.proposal_id, ProposalRejection(reviewed_by="Mme Admin", admin_comment="Déjà couvert")
        )
        self.assertEqual(proposal.status, "rejected")
        self.assertEqual(proposal.admin_comment, "Déjà couvert")
        self.assertIsNotNone(proposal.reviewed_at)
        self.assertIsNone(proposal.approved_action_id)
        self.create_action.assert_not_called()

    def test_rejection_requires_a_comment(self):
        with self.assertRaises(ValueError):
            ProposalRejection(reviewed_by="A", admin_comment="  ")

    def test_a_decision_is_final_and_kept_for_history(self):  # 11
        service.reject_proposal(self.db, self.proposal.proposal_id, ProposalRejection(reviewed_by="A", admin_comment="Non"))
        with self.assertRaises(StateConflictError):
            service.approve_proposal(self.db, self.proposal.proposal_id, ProposalApproval(reviewed_by="B"))
        with self.assertRaises(StateConflictError):
            service.reject_proposal(self.db, self.proposal.proposal_id, ProposalRejection(reviewed_by="B", admin_comment="x"))
        self.assertEqual(self.db.get(SolutionProposal, self.proposal.proposal_id).status, "rejected")
        self.assertEqual(self.proposal.reviewed_by, "A")

    def test_unknown_proposal(self):
        with self.assertRaises(ReferenceNotFoundError):
            service.get_proposal(self.db, 12345)

    def test_admin_view_has_readable_labels(self):
        described = service.describe_proposal(self.db, self.proposal)
        self.assertEqual(described["technician_name"], "Alan")
        self.assertEqual(described["component_name"], "Lecteur de carte")
        self.assertEqual(described["model_name"], "MX5600")
        self.assertEqual(described["error_code"], "E42")
        self.assertEqual(described["problem_label"], "Lecteur de carte — carte non détectée")
        self.assertEqual(len(described["previous_results"]), 2)


class CaseDisplayTests(unittest.TestCase):
    """Dans le chat, une solution validée n'a jamais l'air d'avoir été faite pendant la visite."""

    def test_validated_addition_is_shown_apart_from_the_visit(self):
        case = {
            "technician_name": "Bob",
            "device_label": "Agence Centre",
            "matched_symptom_text": "La carte n'est pas détectée.",
            "final_outcome_status": "resolved",
            "confidence": None,
            "actions": [
                {"description": "Nettoyer le lecteur", "is_confirmed_solution": False, "proposed_by": None},
                {"description": "Remplacer le capteur", "is_confirmed_solution": True, "proposed_by": "Alan"},
            ],
        }
        text = orchestrator._format_case(case, 1)
        self.assertIn("actions tentées : Nettoyer le lecteur,", text)
        self.assertIn("Solution ajoutée ensuite, proposée par Alan et validée par un administrateur : Remplacer le capteur", text)
        self.assertNotIn("Nettoyer le lecteur puis Remplacer le capteur", text)


class AdminAccessTests(unittest.TestCase):
    def test_technician_without_the_admin_key_cannot_review(self):  # 10
        with patch.object(admin_routes.settings, "admin_api_key", "secret-admin"):
            for key in (None, "", "mauvaise-cle"):
                with self.subTest(key=key):
                    with self.assertRaises(AccessDeniedError):
                        admin_routes.require_admin(key)
            admin_routes.require_admin("secret-admin")  # ne lève pas

    def test_administration_is_disabled_without_configured_key(self):
        with patch.object(admin_routes.settings, "admin_api_key", ""):
            with self.assertRaises(AccessDeniedError):
                admin_routes.require_admin("n-importe-quoi")

    def test_every_admin_route_requires_the_key(self):
        dependencies = [dependency.dependency for dependency in admin_routes.router.dependencies]
        self.assertIn(admin_routes.require_admin, dependencies)


class ChatFlagTests(unittest.TestCase):
    """Le bouton « Aucune de ces solutions » n'apparaît qu'après une recherche avec résultats."""

    def setUp(self):
        self.context = {"device_type": "gab"}
        patches = [
            patch.object(orchestrator.conversation_service, "get_or_create_conversation",
                         return_value=SimpleNamespace(conversation_id=CONVERSATION_ID)),
            patch.object(orchestrator.context_service, "get_context", side_effect=lambda db, cid: self.context),
            patch.object(orchestrator.conversation_service, "save_message"),
            patch.object(orchestrator.context_service, "save_context"),
            patch.object(orchestrator.conversation_service, "mark_conversation_active"),
            patch.object(orchestrator.message_understanding_service, "understand_message",
                         return_value=SimpleNamespace(intent="diagnostic")),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_message(self, route):
        with patch.object(orchestrator, "_route_message", side_effect=route):
            return orchestrator.handle_chat_message(MagicMock(), CONVERSATION_ID, TECHNICIAN_ID, "le GAB avale la carte")

    def test_flag_is_set_after_a_search_with_results(self):
        def search(db, context, message, understood):
            orchestrator.context_service.record_last_search(context, "carte avalée", [{"position": 1, "kind": "case"}])
            return "réponse"
        self.assertTrue(self.run_message(search)["solution_proposal_available"])

    def test_flag_is_not_set_without_results_or_without_new_search(self):
        def empty_search(db, context, message, understood):
            orchestrator.context_service.record_last_search(context, "carte avalée", [])
            return "rien trouvé"
        self.assertFalse(self.run_message(empty_search)["solution_proposal_available"])

        self.context = {"device_type": "gab", "last_search": {"query": "x", "results": [{"position": 1}]}}
        self.assertFalse(self.run_message(lambda *args: "simple détail")["solution_proposal_available"])


if __name__ == "__main__":
    unittest.main()
