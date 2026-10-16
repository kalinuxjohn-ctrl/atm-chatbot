"""Verify the relevance instructions sent during case synthesis, without network calls."""

import unittest
from unittest.mock import patch

from app.services import chat_orchestrator_service as orchestrator
from app.services import llm_service, message_understanding_service


class CaseSummaryPromptTests(unittest.TestCase):
    def test_prompt_requires_technical_relevance_before_presenting_cases(self):
        problem = "Le GAB est hors service car les piles sont mortes."
        with (
            patch.object(orchestrator, "_format_case", return_value="Cas 1 : carte retenue."),
            patch.object(orchestrator.llm_service, "generate_reply", return_value="response") as generate,
        ):
            self.assertEqual(orchestrator._summarize_cases(problem, [{}], "gab"), "response")
        generate.assert_called_once()
        prompt = generate.call_args.args[0]
        self.assertIn(problem, prompt)
        self.assertIn("Cas 1 : carte retenue.", prompt)
        self.assertIn("ne garantit PAS leur pertinence technique", prompt)
        self.assertIn("N'invente aucun lien technique", prompt)
        self.assertIn("Si aucun cas ne convient", prompt)
        self.assertIn("Néanmoins, en tant que chatbot d'aide à la maintenance", prompt)
        self.assertIn("Aucune intervention correspondant à ce problème", prompt)
        self.assertIn("Pistes indirectes de l'historique", prompt)
        self.assertIn("Conserve leurs numéros d'origine", prompt)

    def test_empty_candidates_request_explicitly_labeled_suggestions(self):
        with patch.object(orchestrator.llm_service, "generate_reply", return_value="suggestions") as generate:
            self.assertEqual(
                orchestrator._summarize_cases("problem", []),
                "suggestions",
            )
        self.assertIn("Aucun cas candidat.", generate.call_args.args[0])
        self.assertIn("n'ajoute pas de long avertissement", generate.call_args.args[0])

    def test_aggregate_prompt_handles_empty_and_nonempty_results(self):
        for solutions in ([], [dict(symptom_text="carte", action_text="test", successes=1,
                                    attempts=2, accuracy_score=0.5)]):
            with patch.object(llm_service, "generate_reply", return_value="reply") as generate:
                self.assertEqual(llm_service.summarize_solutions("rejet", solutions, "gab"), "reply")
            self.assertIn("Néanmoins, en tant que chatbot d'aide à la maintenance", generate.call_args.args[0])
            self.assertIn("En complément, voici mes conseils de chatbot", generate.call_args.args[0])

    def test_followup_prompt_preserves_provenance_and_allows_markdown(self):
        self.assertIn("En complément, voici mes conseils de chatbot", message_understanding_service._SYSTEM_PROMPT)
        self.assertIn("Ne prétends pas avoir cherché", message_understanding_service._SYSTEM_PROMPT)
        self.assertIn("**gras**", message_understanding_service._SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
