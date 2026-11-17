"""Verify the relevance instructions sent during case synthesis, without network calls."""

import unittest
from unittest.mock import patch

from app.services import chat_orchestrator_service as orchestrator
from app.services import claude_service, message_understanding_service


class CaseSummaryPromptTests(unittest.TestCase):
    def test_prompt_requires_technical_relevance_before_presenting_cases(self):
        problem = "Le GAB est hors service car les piles sont mortes."
        with (
            patch.object(orchestrator, "_format_case", return_value="Cas 1 : carte retenue."),
            patch.object(orchestrator.claude_service, "generate_chat_reply", return_value="response") as generate,
        ):
            self.assertEqual(orchestrator._summarize_cases(problem, [{}], "gab"), "response")
        generate.assert_called_once()
        prompt = generate.call_args.args[0] + generate.call_args.args[1][0]["content"]
        self.assertTrue(generate.call_args.kwargs["cache_history"])
        self.assertNotIn(problem, generate.call_args.args[0])
        self.assertIn(problem, prompt)
        self.assertIn("Cas 1 : carte retenue.", prompt)
        self.assertIn("ne garantit PAS leur pertinence technique", prompt)
        self.assertIn("N'invente aucun lien technique", prompt)
        self.assertIn("J'ai trouvé N cas pertinents", prompt)
        self.assertIn("Présente uniquement les cas qui répondent directement", prompt)
        self.assertIn("ne mentionne jamais la provenance", prompt)
        self.assertIn("au plus deux vérifications directement liées", prompt)
        self.assertIn("Je n'ai trouvé aucun cas directement pertinent", prompt)
        self.assertIn("Garde pour chaque cas son numéro d'origine", prompt)
        self.assertIn("ne justifie pas leur omission", prompt)
        self.assertIn("sans section « Cas écartés »", prompt)
        self.assertNotIn("Pistes indirectes de l'historique", prompt)

    def test_empty_candidates_request_explicitly_labeled_suggestions(self):
        with patch.object(orchestrator.claude_service, "generate_chat_reply", return_value="suggestions") as generate:
            self.assertEqual(
                orchestrator._summarize_cases("problem", []),
                "suggestions",
            )
        self.assertIn("Aucun cas candidat.", generate.call_args.args[1][0]["content"])
        self.assertIn("S'il n'y a aucun cas pertinent", generate.call_args.args[0])
        self.assertIn("au plus deux vérifications ciblées", generate.call_args.args[0])
        self.assertIn("n'ajoute pas de conseils génériques", generate.call_args.args[0])

    def test_aggregate_prompt_handles_empty_and_nonempty_results(self):
        for solutions in ([], [dict(symptom_text="carte", action_text="test", successes=1,
                                    attempts=2, accuracy_score=0.5)]):
            with patch.object(claude_service, "generate_chat_reply", return_value="reply") as generate:
                self.assertEqual(claude_service.summarize_solutions("rejet", solutions, "gab"), "reply")
            self.assertIn("de façon directe et exploitable", generate.call_args.args[0])
            self.assertIn("au plus deux vérifications directement liées", generate.call_args.args[0])
            self.assertIn("Reste sous 100 mots", generate.call_args.args[0])

    def test_followup_prompt_preserves_provenance_and_allows_markdown(self):
        self.assertIn("En complément, voici mes conseils de chatbot", message_understanding_service._SYSTEM_PROMPT)
        self.assertIn("Ne prétends pas avoir cherché", message_understanding_service._SYSTEM_PROMPT)
        self.assertIn("**gras**", message_understanding_service._SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
