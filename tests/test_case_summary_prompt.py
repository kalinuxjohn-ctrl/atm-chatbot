"""Verify the relevance instructions sent during case synthesis, without network calls."""

import unittest
from unittest.mock import patch

from app.services import chat_orchestrator_service as orchestrator


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
        self.assertIn("ni une solution issue de tes connaissances", prompt)
        self.assertIn("Conserve leurs numéros d'origine", prompt)

    def test_empty_candidates_do_not_call_the_llm(self):
        with patch.object(orchestrator.llm_service, "generate_reply") as generate:
            self.assertEqual(
                orchestrator._summarize_cases("problem", []),
                "Aucun cas similaire trouvé dans l'historique.",
            )
        generate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
