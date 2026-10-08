"""Sélection des fournisseurs LLM conservés, sans requête réseau."""

import unittest
from unittest.mock import patch

from app.core.config import Settings
from app.services import llm_service


class LLMProviderTests(unittest.TestCase):
    def test_default_is_claude(self):
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)
        self.assertEqual(settings.llm_provider, "claude")

    def test_supported_providers(self):
        providers = {"claude": llm_service.ClaudeProvider, "gemini": llm_service.GeminiProvider}
        self.assertEqual(set(llm_service._PROVIDERS), set(providers))
        for name, provider_type in providers.items():
            with self.subTest(provider=name):
                with patch.object(llm_service.settings, "llm_provider", name):
                    self.assertIsInstance(llm_service.get_llm_provider(), provider_type)

    def test_unknown_provider_is_an_explicit_error(self):
        with patch.object(llm_service.settings, "llm_provider", "unsupported"):
            with self.assertRaisesRegex(llm_service.LLMUnavailableError, "Fournisseur LLM inconnu"):
                llm_service.get_llm_provider()


if __name__ == "__main__":
    unittest.main()
