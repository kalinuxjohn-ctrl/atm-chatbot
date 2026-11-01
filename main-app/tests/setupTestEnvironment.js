/**
 * Variables d'environnement des tests (chargé par Jest avant chaque fichier).
 *
 * Les tests d'intégration ont besoin d'une vraie base PostgreSQL avec les
 * migrations 0001 à 0018 : voir tests/integration/README.md. Sans
 * MAIN_APP_TEST_DATABASE_HOST, ils sont ignorés (les tests unitaires tournent seuls).
 */

import os from "node:os";
import path from "node:path";

const testEnvironment = {
  MAIN_APP_ENVIRONMENT: "test",
  MAIN_APP_DATABASE_HOST: process.env.MAIN_APP_TEST_DATABASE_HOST ?? "database-not-configured",
  MAIN_APP_DATABASE_PORT: process.env.MAIN_APP_TEST_DATABASE_PORT ?? "5432",
  MAIN_APP_DATABASE_NAME: process.env.MAIN_APP_TEST_DATABASE_NAME ?? "atm_chatbot",
  MAIN_APP_DATABASE_USER: process.env.MAIN_APP_TEST_DATABASE_USER ?? "main_app_user",
  MAIN_APP_DATABASE_PASSWORD: process.env.MAIN_APP_TEST_DATABASE_PASSWORD ?? "test-password-not-used",
  MAIN_APP_COOKIE_SECURE: "false",
  MAIN_APP_ALLOW_REGISTRATION: "true",
  MAIN_APP_LOGIN_MAX_FAILED_ATTEMPTS: "3",
  MAIN_APP_LOGIN_LOCK_MINUTES: "15",
  MAIN_APP_MAP_TILE_URL_TEMPLATE: "https://tiles.example.test/{z}/{x}/{y}.png",
  MAIN_APP_MAP_TILE_ATTRIBUTION: "© Test",
  MAIN_APP_MAP_TILE_USER_AGENT: "atm-main-app-tests",
  MAIN_APP_UPLOAD_MAX_BYTES: String(2 * 1024 * 1024),
  MAIN_APP_UPLOADS_DIRECTORY: path.join(os.tmpdir(), "main-app-test-uploads"),
  MAIN_APP_PUBLIC_ORIGIN: "http://localhost:8080",
};

for (const [variableName, variableValue] of Object.entries(testEnvironment)) {
  process.env[variableName] = variableValue;
}
