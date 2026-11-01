/**
 * Démarre le serveur HTTP d'un conteneur et l'arrête proprement.
 *
 * `docker compose stop` envoie SIGTERM : on cesse d'accepter des connexions,
 * on laisse finir les requêtes en cours, puis on ferme le pool de la base.
 * Les sessions étant en base, un redémarrage ne déconnecte personne.
 */

import http from "node:http";

import { closeDatabasePool, initializeDatabasePool } from "./database.js";
import { trace } from "./tracing.js";

export function startFeatureServer({ featureApp, configuration, onServerCreated = () => {}, onShutdown = () => {} }) {
  initializeDatabasePool(configuration);
  const httpServer = http.createServer(featureApp);
  // Protège contre les clients qui envoient leurs en-têtes très lentement (slowloris).
  httpServer.headersTimeout = 20_000;
  httpServer.requestTimeout = 120_000;
  onServerCreated(httpServer);

  httpServer.listen(configuration.MAIN_APP_PORT, () => {
    trace("STARTUP", "Conteneur prêt", { feature: configuration.featureName, port: configuration.MAIN_APP_PORT });
  });

  let shutdownStarted = false;
  async function shutDownGracefully(signalName) {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    trace("SHUTDOWN", "Arrêt demandé", { signalName });
    await onShutdown();
    httpServer.close(async () => {
      await closeDatabasePool();
      process.exit(0);
    });
    // Filet de sécurité : des connexions persistantes ne doivent pas bloquer l'arrêt.
    setTimeout(() => process.exit(0), 10_000).unref();
  }
  process.on("SIGTERM", () => shutDownGracefully("SIGTERM"));
  process.on("SIGINT", () => shutDownGracefully("SIGINT"));

  return httpServer;
}
