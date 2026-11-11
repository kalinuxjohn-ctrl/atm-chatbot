import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import start


class LocalStartupTests(unittest.TestCase):
    def test_shared_node_image_has_only_one_build_owner(self):
        compose = (Path(__file__).resolve().parents[1] / "docker-compose.main-app.yml").read_text(encoding="utf-8")
        common = compose.split("x-main-app-node-service: &main-app-node-service", 1)[1].split(
            "x-main-app-shared-environment:", 1,
        )[0]
        self.assertNotIn("  build:", common)
        self.assertIn("  image: atm-main-app:latest", common)
        self.assertIn("  pull_policy: never", common)
        auth = compose.split("  main-app-auth:\n", 1)[1].split("  main-app-map:\n", 1)[0]
        self.assertIn("    build:", auth)

    def test_start_uses_compose_to_build_the_base_dependency(self):
        for rebuild_base in (False, True):
            with (
                self.subTest(rebuild_base=rebuild_base),
                patch.object(start, "prepare_configuration"),
                patch.object(start, "run") as run,
                patch.object(start, "published_port", return_value=8080),
                patch.object(start, "check_http"),
                patch.object(start, "bootstrap_administrator"),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                start.start(rebuild_base=rebuild_base)
                commands = [call.args[0] for call in run.call_args_list]
                self.assertIn(start.COMPOSE + [
                    "build", "web", "init-db", "chatbot-frontend", "main-app-auth", "main-app-gateway",
                ], commands)
                self.assertEqual(
                    start.COMPOSE + ["build", "--no-cache", "python-base"] in commands,
                    rebuild_base,
                )
                self.assertFalse(any(command[:2] == ["docker", "build"] for command in commands))

    def test_status_does_not_acquire_startup_lock(self):
        with patch.object(start.sys, "argv", ["start.py", "status"]):
            with patch.object(start, "run") as run, patch.object(start.fcntl, "flock") as lock:
                run.return_value.stdout = "db\nweb\nmain-app-auth\n"
                start.main()
                lock.assert_not_called()
                self.assertEqual(run.call_args.args[0], start.COMPOSE + ["ps", "-a", "db", "web", "main-app-auth"])

    def test_existing_configuration_is_not_replaced(self):
        configured = {
            "MAIN_APP_DATABASE_PASSWORD": "existing-database-password",
            "ADMIN_API_KEY": "existing-admin-key",
            "ATM_CHATBOT_GATEWAY_SHARED_SECRET": "existing-gateway-secret",
            "MAIN_APP_MAP_TILE_URL_TEMPLATE": "https://tiles.test/{z}/{x}/{y}",
            "MAIN_APP_MAP_TILE_USER_AGENT": "existing-user-agent",
        }
        self.assertEqual(start.missing_configuration(configured), {})

    def test_missing_secrets_are_random_and_long_enough(self):
        first = start.missing_configuration({})
        second = start.missing_configuration({})
        for key in ("MAIN_APP_DATABASE_PASSWORD", "ADMIN_API_KEY", "ATM_CHATBOT_GATEWAY_SHARED_SECRET"):
            self.assertGreaterEqual(len(first[key]), 32)
            self.assertNotEqual(first[key], second[key])

    def test_configuration_is_appended_only_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = "# Existing configuration\nDATABASE_URL=existing-value\n"
            (root / ".env").write_text(original, encoding="utf-8")
            environment = {
                "DATABASE_URL": "existing-value", "LLM_PROVIDER": "gemini",
                "GEMINI_API_KEY": "test-key", "VOYAGE_API_KEY": "test-key",
            }
            with patch.object(start, "ROOT", root), patch.object(start, "read_environment", return_value=environment):
                with contextlib.redirect_stdout(io.StringIO()):
                    start.prepare_configuration()
                    first_content = (root / ".env").read_text(encoding="utf-8")
                    environment.update(start.missing_configuration(environment))
                    start.prepare_configuration()
            self.assertTrue(first_content.startswith(original))
            self.assertEqual((root / ".env").read_text(encoding="utf-8"), first_content)

    def test_missing_api_key_fails_before_modifying_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("unchanged", encoding="utf-8")
            with patch.object(start, "ROOT", root), patch.object(start, "read_environment", return_value={}):
                with self.assertRaisesRegex(RuntimeError, "VOYAGE_API_KEY"):
                    start.prepare_configuration()
            self.assertEqual((root / ".env").read_text(encoding="utf-8"), "unchanged")

    def test_existing_administrator_is_never_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(start, "ROOT", Path(directory)), patch.object(start, "run") as run:
                run.return_value.stdout = '{"hasActiveAdministrator":true}'
                with contextlib.redirect_stdout(io.StringIO()):
                    start.bootstrap_administrator()
                self.assertEqual(run.call_count, 1)
                self.assertFalse((Path(directory) / ".local" / "initial-admin.json").exists())

    def test_bootstrap_persists_password_without_printing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".local").mkdir()
            with patch.object(start, "ROOT", root), patch.object(start, "run") as run:
                run.return_value.stdout = '{"hasActiveAdministrator":false}'
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    start.bootstrap_administrator()
                path = root / ".local" / "initial-admin.json"
                credentials = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(credentials["username"], "admin")
                self.assertGreaterEqual(len(credentials["password"]), 32)
                self.assertNotIn(credentials["password"], output.getvalue())
                self.assertEqual(json.loads(run.call_args.kwargs["input"]), credentials)
                with contextlib.redirect_stdout(output):
                    start.bootstrap_administrator()
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")), credentials)


if __name__ == "__main__":
    unittest.main()
