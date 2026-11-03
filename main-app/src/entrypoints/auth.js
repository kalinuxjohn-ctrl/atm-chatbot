/**
 * Conteneur main-app-auth : connexion, sessions, comptes et rôles.
 * Pages : web/auth/ (login.html, register.html). La gestion des comptes est une
 * rubrique de la page Administration (gateway/html/admin/), qui appelle cette API.
 */

import { loadConfiguration } from "../core/config.js";
import { createFeatureApp } from "../core/createFeatureApp.js";
import { startFeatureServer } from "../core/startFeatureServer.js";
import { trace } from "../core/tracing.js";
import { cleanupExpiredSessions } from "../jobs/cleanupExpiredSessions.js";
import { createAuthRouter } from "../routes/auth/authRoutes.js";

const ONE_HOUR_MILLISECONDS = 60 * 60 * 1000;

const configuration = loadConfiguration("auth");
const featureApp = createFeatureApp({ featureName: "auth", configuration, apiRouter: createAuthRouter() });

startFeatureServer({ featureApp, configuration });

const sessionCleanupTimer = setInterval(() => {
  cleanupExpiredSessions().catch((error) => trace("ERROR", "Nettoyage des sessions impossible", { errorMessage: error.message }));
}, ONE_HOUR_MILLISECONDS);
sessionCleanupTimer.unref();
