/**
 * Garde-fous de la configuration : ce qui affaiblit la sécurité est refusé en production.
 */

import { forgetLoadedConfiguration, loadConfiguration } from "../../../src/core/config.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  forgetLoadedConfiguration();
});

describe("connexion automatique de développement", () => {
  test("refusée en production", () => {
    process.env.MAIN_APP_ENVIRONMENT = "production";
    process.env.MAIN_APP_COOKIE_SECURE = "true";
    process.env.MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME = "alan_admin";
    expect(() => loadConfiguration("jobs")).toThrow(/MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME est interdit en production/);
  });

  test("acceptée hors production", () => {
    process.env.MAIN_APP_ENVIRONMENT = "development";
    process.env.MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME = "alan_admin";
    expect(loadConfiguration("jobs").MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME).toBe("alan_admin");
  });

  test("vide = désactivée (docker compose transmet une variable absente comme chaîne vide)", () => {
    process.env.MAIN_APP_ENVIRONMENT = "production";
    process.env.MAIN_APP_COOKIE_SECURE = "true";
    process.env.MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME = "";
    expect(loadConfiguration("jobs").MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME).toBeUndefined();
  });
});
