/**
 * WebSocket de signalisation (/api/calls/ws) : la SEULE fonctionnalité en
 * temps réel de la main app (la messagerie, elle, utilise le polling).
 *
 * À l'ouverture (requête HTTP « Upgrade ») :
 * 1. l'en-tête Origin doit être exactement MAIN_APP_PUBLIC_ORIGIN : une page
 *    d'un autre site ne peut pas ouvrir de WebSocket avec le cookie de
 *    l'utilisateur (le navigateur l'enverrait, SameSite ou non, sur un WebSocket) ;
 * 2. le cookie de session doit correspondre à une session valide.
 * Ensuite, chaque message : taille limitée (maxPayload), débit limité par
 * connexion, JSON validé avec zod. La session est revérifiée régulièrement :
 * une déconnexion ou un compte désactivé ferme la connexion.
 */

import { WebSocketServer } from "ws";

import { readCookieValue } from "../../core/cookies.js";
import { getSessionCookieName } from "../../core/sessionStore.js";
import { trace } from "../../core/tracing.js";
import { clientSignalingMessageSchema } from "../../schemas/calls/callSchemas.js";

export const SIGNALING_WEBSOCKET_PATH = "/api/calls/ws";
const MAXIMUM_MESSAGE_BYTES = 32 * 1024;
// Seau de jetons : 60 messages d'un coup (rafale de candidats ICE), puis 20 par seconde.
const RATE_LIMIT_BURST_MESSAGES = 60;
const RATE_LIMIT_MESSAGES_PER_SECOND = 20;
const SESSION_RECHECK_MILLISECONDS = 5 * 60 * 1000;
const HEARTBEAT_MILLISECONDS = 30_000;

// Codes de fermeture propres à l'application (plage 4000-4999).
export const CLOSE_CODE_SESSION_INVALID = 4401;
export const CLOSE_CODE_RATE_LIMITED = 4429;

function rejectUpgrade(socket, httpStatus, statusText) {
  socket.write(`HTTP/1.1 ${httpStatus} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function createMessageRateLimiter() {
  let availableTokens = RATE_LIMIT_BURST_MESSAGES;
  let lastRefillTime = Date.now();
  return function consumeMessageToken() {
    const now = Date.now();
    availableTokens = Math.min(
      RATE_LIMIT_BURST_MESSAGES,
      availableTokens + ((now - lastRefillTime) / 1000) * RATE_LIMIT_MESSAGES_PER_SECOND,
    );
    lastRefillTime = now;
    if (availableTokens < 1) {
      return false;
    }
    availableTokens -= 1;
    return true;
  };
}

/**
 * Branche le WebSocket sur le serveur HTTP du conteneur.
 * `findAuthenticatedUserBySessionToken` est injecté (la vraie fonction lit
 * la base ; les tests en passent une fausse).
 */
export function attachCallSignalingWebSocket({ httpServer, configuration, coordinator, findAuthenticatedUserBySessionToken }) {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAXIMUM_MESSAGE_BYTES });
  const sessionCookieName = getSessionCookieName(configuration.MAIN_APP_COOKIE_SECURE);

  httpServer.on("upgrade", async (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    const requestPath = new URL(request.url, "http://upgrade.local").pathname;
    if (requestPath !== SIGNALING_WEBSOCKET_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (request.headers.origin !== configuration.MAIN_APP_PUBLIC_ORIGIN) {
      trace("CALLS", "WebSocket refusé : origine non autorisée");
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    const sessionToken = readCookieValue(request.headers.cookie, sessionCookieName);
    let authenticatedUser = null;
    try {
      authenticatedUser = sessionToken ? await findAuthenticatedUserBySessionToken(sessionToken) : null;
    } catch {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    if (!authenticatedUser) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      handleAuthenticatedConnection(webSocket, authenticatedUser, sessionToken);
    });
  });

  function handleAuthenticatedConnection(webSocket, authenticatedUser, sessionToken) {
    const connection = {
      technicianId: authenticatedUser.technicianId,
      username: authenticatedUser.username,
      sendMessage(message) {
        if (webSocket.readyState === webSocket.OPEN) {
          webSocket.send(JSON.stringify(message));
        }
      },
    };
    const consumeMessageToken = createMessageRateLimiter();
    let isAlive = true;

    // Ping régulier : une connexion morte (réseau mobile coupé) est détectée et libère l'appel.
    const heartbeatTimer = setInterval(() => {
      if (!isAlive) {
        webSocket.terminate();
        return;
      }
      isAlive = false;
      webSocket.ping();
    }, HEARTBEAT_MILLISECONDS);
    webSocket.on("pong", () => {
      isAlive = true;
    });

    const sessionRecheckTimer = setInterval(async () => {
      const stillAuthenticatedUser = await findAuthenticatedUserBySessionToken(sessionToken).catch(() => authenticatedUser);
      if (!stillAuthenticatedUser) {
        webSocket.close(CLOSE_CODE_SESSION_INVALID, "Session expirée");
      }
    }, SESSION_RECHECK_MILLISECONDS);

    webSocket.on("message", async (rawMessage, isBinary) => {
      if (!consumeMessageToken()) {
        webSocket.close(CLOSE_CODE_RATE_LIMITED, "Trop de messages");
        return;
      }
      if (isBinary) {
        connection.sendMessage({ type: "error", code: "invalid_message", message: "Message texte JSON attendu." });
        return;
      }
      let parsedJson;
      try {
        parsedJson = JSON.parse(rawMessage.toString("utf8"));
      } catch {
        connection.sendMessage({ type: "error", code: "invalid_message", message: "JSON invalide." });
        return;
      }
      const validation = clientSignalingMessageSchema.safeParse(parsedJson);
      if (!validation.success) {
        connection.sendMessage({ type: "error", code: "invalid_message", message: "Message de signalisation invalide." });
        return;
      }
      try {
        await coordinator.handleClientMessage(connection, validation.data);
      } catch (error) {
        trace("ERROR", "Message de signalisation non traité", { errorMessage: error.message });
        connection.sendMessage({ type: "error", code: "internal_error", message: "Erreur interne." });
      }
    });

    webSocket.on("close", () => {
      clearInterval(heartbeatTimer);
      clearInterval(sessionRecheckTimer);
      coordinator.connectionClosed(connection);
    });
    webSocket.on("error", () => webSocket.terminate());

    coordinator.connectionOpened(connection);
  }

  return webSocketServer;
}
