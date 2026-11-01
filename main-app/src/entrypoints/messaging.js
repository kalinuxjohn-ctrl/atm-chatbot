/**
 * Conteneur main-app-messaging : conversations, messages texte, images et
 * messages vocaux. Seul conteneur qui monte le volume main-app-uploads.
 * Pages : web/messaging/.
 */

import { loadConfiguration } from "../core/config.js";
import { createFeatureApp } from "../core/createFeatureApp.js";
import { startFeatureServer } from "../core/startFeatureServer.js";
import { trace } from "../core/tracing.js";
import { cleanupOrphanUploads } from "../jobs/cleanupOrphanUploads.js";
import { createMessagingRouter } from "../routes/messaging/messagingRoutes.js";

const SIX_HOURS_MILLISECONDS = 6 * 60 * 60 * 1000;

const configuration = loadConfiguration("messaging");
const featureApp = createFeatureApp({ featureName: "messaging", configuration, apiRouter: createMessagingRouter() });

startFeatureServer({ featureApp, configuration });

const orphanCleanupTimer = setInterval(() => {
  cleanupOrphanUploads(configuration.MAIN_APP_UPLOADS_DIRECTORY).catch((error) =>
    trace("ERROR", "Nettoyage des fichiers orphelins impossible", { errorMessage: error.message }),
  );
}, SIX_HOURS_MILLISECONDS);
orphanCleanupTimer.unref();
