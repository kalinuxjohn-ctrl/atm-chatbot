"""Recherche par symptôme : chaque symptôme du technicien a son propre embedding, sans réseau ni base."""

import unittest
from unittest.mock import MagicMock, patch

from app.schemas.message_understanding_schema import UnderstoodMessage
from app.services import case_retrieval_service, retrieval_service
from app.services import chat_orchestrator_service as orchestrator
from app.services import message_understanding_service


def _row(intervention_id, intervention_symptom_id, raw_text, similarity):
    return {
        "intervention_id": intervention_id,
        "intervention_symptom_id": intervention_symptom_id,
        "symptom_id": None,
        "raw_text": raw_text,
        "similarity": similarity,
    }


class UnderstoodSymptomsTests(unittest.TestCase):
    def test_symptoms_are_cleaned_deduplicated_and_renumbered(self):
        understood = UnderstoodMessage(
            intent="diagnostic",
            reformulated_problem_text="Écran noir et carte bloquée",
            symptoms=[
                {"number": 3, "text": "  L'écran est   noir "},
                {"number": 7, "text": "l'écran est noir"},
                {"number": 9, "text": ""},
                "La carte reste bloquée",
            ],
        )
        self.assertEqual(
            [symptom.model_dump() for symptom in understood.symptoms],
            [{"number": 1, "text": "L'écran est noir"}, {"number": 2, "text": "La carte reste bloquée"}],
        )

    def test_missing_or_null_symptoms_give_an_empty_list(self):
        self.assertEqual(UnderstoodMessage(intent="conversation", reply="ok").symptoms, [])
        self.assertEqual(UnderstoodMessage(intent="conversation", reply="ok", symptoms=None).symptoms, [])

    def test_prompt_asks_for_numbered_symptoms(self):
        self.assertIn('"symptoms"', message_understanding_service._SYSTEM_PROMPT)
        self.assertIn("numéroté à partir de 1", message_understanding_service._SYSTEM_PROMPT)


class PerSymptomEmbeddingTests(unittest.TestCase):
    def test_several_symptoms_use_one_batch_call_and_one_search_each(self):
        with (
            patch.object(retrieval_service, "generate_embeddings_batch", return_value=[[0.1], [0.2]]) as batch,
            patch.object(retrieval_service, "fetch_similar_symptoms", side_effect=[["a"], ["b"]]) as fetch,
        ):
            result = retrieval_service.fetch_similar_symptoms_per_symptom(
                MagicMock(), ["écran noir", "carte bloquée"], "gab", limit=8
            )
        self.assertEqual(result, [["a"], ["b"]])
        batch.assert_called_once_with(["écran noir", "carte bloquée"], is_query=True)
        self.assertEqual([call.kwargs["query_vector"] for call in fetch.call_args_list], [[0.1], [0.2]])

    def test_single_symptom_keeps_the_cached_path(self):
        with (
            patch.object(retrieval_service, "generate_embeddings_batch") as batch,
            patch.object(retrieval_service, "fetch_similar_symptoms", return_value=["a"]) as fetch,
        ):
            result = retrieval_service.fetch_similar_symptoms_per_symptom(MagicMock(), ["écran noir"], "gab")
        self.assertEqual(result, [["a"]])
        batch.assert_not_called()
        self.assertNotIn("query_vector", fetch.call_args.kwargs)


class CaseGroupingTests(unittest.TestCase):
    def test_intervention_matching_several_symptoms_ranks_first_and_keeps_every_match(self):
        symptoms = [{"number": 1, "text": "écran noir"}, {"number": 2, "text": "carte bloquée"}]
        rows_per_symptom = [
            [_row(10, 101, "Écran éteint", 0.70), _row(20, 201, "Écran noir au démarrage", 0.95)],
            [_row(10, 102, "Carte retenue", 0.80), _row(10, 103, "Carte avalée", 0.60)],
        ]
        with (
            patch.object(case_retrieval_service, "fetch_similar_symptoms_per_symptom", return_value=rows_per_symptom),
            patch.object(case_retrieval_service, "build_case",
                         side_effect=lambda db, iid, **kwargs: {"intervention_id": iid, **kwargs}),
        ):
            cases = case_retrieval_service.find_similar_cases(
                MagicMock(), "problème", "gab", symptoms=symptoms
            )

        # 10 recoupe les 2 symptômes : il passe devant 20, pourtant plus proche sur un seul.
        self.assertEqual([case["intervention_id"] for case in cases], [10, 20])
        first = cases[0]
        self.assertEqual(
            [(m["query_symptom_number"], m["intervention_symptom_id"]) for m in first["matched_symptoms"]],
            [(1, 101), (2, 102)],
        )
        # Le symptôme le plus proche reste la référence unique du cas.
        self.assertEqual(first["matched_intervention_symptom_id"], 102)
        self.assertEqual(first["matched_symptom_text"], "Carte retenue")

    def test_without_symptoms_the_full_text_is_searched_as_one_symptom(self):
        with patch.object(case_retrieval_service, "fetch_similar_symptoms_per_symptom", return_value=[[]]) as fetch:
            self.assertEqual(case_retrieval_service.find_similar_cases(MagicMock(), "carte bloquée", "gab"), [])
        self.assertEqual(fetch.call_args.args[1], ["carte bloquée"])


class OrchestratorSymptomTests(unittest.TestCase):
    def test_symptoms_are_passed_to_the_search_and_remembered(self):
        context = {"device_type": "gab"}
        understood = UnderstoodMessage(
            intent="diagnostic",
            reformulated_problem_text="Écran noir et carte bloquée",
            symptoms=["Écran noir", "Carte bloquée"],
        )
        matches = [{"query_symptom_number": 1, "query_symptom_text": "Écran noir",
                    "intervention_symptom_id": 101, "raw_text": "Écran éteint", "similarity": 0.7}]
        cases = [{"intervention_id": 10, "matched_symptoms": matches}]
        with (
            patch.object(orchestrator.technical_reference_resolver_service,
                         "resolve_technical_references", return_value={}),
            patch.object(orchestrator.case_retrieval_service, "find_similar_cases", return_value=cases) as search,
            patch.object(orchestrator, "_summarize_cases", return_value="reply") as summarize,
        ):
            orchestrator._handle_symptom_search(MagicMock(), context, understood)

        expected = [{"number": 1, "text": "Écran noir"}, {"number": 2, "text": "Carte bloquée"}]
        self.assertEqual(search.call_args.kwargs["symptoms"], expected)
        self.assertEqual(summarize.call_args.args[3], expected)
        self.assertEqual(context["last_search"]["symptoms"], expected)
        self.assertEqual(context["last_search"]["results"][0]["matched_symptoms"], matches)

    def test_case_text_lists_each_matched_symptom(self):
        case = {
            "technician_name": "Alice", "device_label": "Agence", "actions": [],
            "final_outcome_status": "resolved", "confidence": None,
            "matched_symptoms": [
                {"query_symptom_number": 1, "raw_text": "Écran éteint"},
                {"query_symptom_number": 2, "raw_text": "Carte retenue"},
            ],
        }
        text = orchestrator._format_case(case, 1)
        self.assertIn("symptômes recoupés", text)
        self.assertIn("« Écran éteint » (recoupe le symptôme 1 du technicien)", text)
        self.assertIn("« Carte retenue » (recoupe le symptôme 2 du technicien)", text)

    def test_summary_prompt_mentions_symptom_numbers_only_when_several(self):
        symptoms = [{"number": 1, "text": "Écran noir"}, {"number": 2, "text": "Carte bloquée"}]
        with patch.object(orchestrator.llm_service, "generate_reply", return_value="r") as generate:
            orchestrator._summarize_cases("problème", [], "gab", symptoms)
            orchestrator._summarize_cases("problème", [], "gab", symptoms[:1])
        several, single = (call.args[0] for call in generate.call_args_list)
        self.assertIn("1. « Écran noir » ; 2. « Carte bloquée »", several)
        self.assertNotIn("cherchés séparément", single)


if __name__ == "__main__":
    unittest.main()
