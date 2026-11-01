/**
 * Supprime les sessions expirées et les anciens compteurs d'échecs de connexion.
 *
 * Lancé toutes les heures par le conteneur auth (src/entrypoints/auth.js), ou
 * à la main : node src/jobs/cleanupExpiredSessions.js
 * Une session expirée est déjà refusée à la vérification : ce nettoyage ne
 * sert qu'à garder les tables petites.
 */

import { pathToFileURL } from "node:url";

import { loadConfiguration } from "../core/config.js";
import { closeDatabasePool, initializeDatabasePool } from "../core/database.js";
import { deleteExpiredSessions } from "../core/sessionStore.js";
import { trace } from "../core/tracing.js";
import { deleteExpiredThrottles } from "../models/auth/loginThrottleModel.js";

export async function cleanupExpiredSessions() {
  const deletedSessionCount = await deleteExpiredSessions();
  const deletedThrottleCount = await deleteExpiredThrottles();
  trace("JOB", "Sessions expirées nettoyées", { deletedSessionCount, deletedThrottleCount });
}

// Lancé directement (et non importé par auth.js) : exécution unique.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  initializeDatabasePool(loadConfiguration("jobs"));
  cleanupExpiredSessions()
    .catch((error) => {
      trace("ERROR", "Nettoyage des sessions impossible", { errorMessage: error.message });
      process.exitCode = 1;
    })
    .finally(closeDatabasePool);
}
