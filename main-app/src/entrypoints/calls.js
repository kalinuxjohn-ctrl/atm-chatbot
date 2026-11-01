/**
 * Conteneur main-app-calls : signalisation WebSocket des appels vocaux
 * (WebRTC pair-à-pair, aucun son ne transite par ici) et journal des appels.
 * Pages : web/calls/.
 */

import { loadConfiguration } from "../core/config.js";
import { createFeatureApp } from "../core/createFeatureApp.js";
import { findAuthenticatedUserBySessionToken } from "../core/sessionStore.js";
import { startFeatureServer } from "../core/startFeatureServer.js";
import { attachCallSignalingWebSocket } from "../controllers/calls/callSignalingSocketController.js";
import { findCallableAccount, insertCallLog } from "../models/calls/callModel.js";
import { createCallRouter } from "../routes/calls/callRoutes.js";
import { createCallSignalingCoordinator } from "../services/calls/callSignalingCoordinator.js";

const configuration = loadConfiguration("calls");
const coordinator = createCallSignalingCoordinator({ findCallableAccount, recordCallLog: insertCallLog });
const featureApp = createFeatureApp({ featureName: "calls", configuration, apiRouter: createCallRouter() });
featureApp.locals.callSignalingCoordinator = coordinator;

let signalingWebSocketServer = null;
startFeatureServer({
  featureApp,
  configuration,
  onServerCreated: (httpServer) => {
    signalingWebSocketServer = attachCallSignalingWebSocket({ httpServer, configuration, coordinator, findAuthenticatedUserBySessionToken });
  },
  // Arrêt : appels terminés et journalisés, puis WebSockets fermés (sinon le serveur HTTP attendrait leur fin).
  onShutdown: () => {
    coordinator.endAllCalls();
    for (const webSocket of signalingWebSocketServer?.clients ?? []) {
      webSocket.close(1001, "Redémarrage du service d'appel");
    }
  },
});
