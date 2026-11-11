import tempfile
from pathlib import Path
import unittest

from scripts.build_branding import apply_branding


class BuildBrandingTests(unittest.TestCase):
    def test_all_web_surfaces_without_changing_routes_or_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = {
                "page.html": '<title>Espace techniciens</title><span>ATM-<strong>Chatbot</strong></span><a href="/atm-chatbot/">ATM-Chatbot</a>',
                "shell.js": 'const label = "ATM-Chatbot"; const path = "/atm-chatbot/"; const key = "atm-chatbot-session";',
                "logo.svg": "<title>ATM-Chatbot</title>",
            }
            for filename, source in sources.items():
                (root / filename).write_text(source, encoding="utf-8")
            apply_branding(root, "terrain-test")
            for filename in sources:
                result = (root / filename).read_text(encoding="utf-8")
                self.assertIn("terrain-test", result)
                self.assertNotIn("ATM-Chatbot", result)
                self.assertNotIn("Espace techniciens", result)
            self.assertIn('href="/atm-chatbot/"', (root / "page.html").read_text())
            self.assertIn('"atm-chatbot-session"', (root / "shell.js").read_text())
            apply_branding(root, "terrain-test")

    def test_invalid_names_fail_explicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ("", "<script>", "a'b", "a`b", "a\nb", "x" * 81):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    apply_branding(directory, name)

    def test_missing_directory_fails(self):
        with self.assertRaises(ValueError):
            apply_branding("missing-web-assets-directory", "atm-chatbot")


if __name__ == "__main__":
    unittest.main()
