/**
 * Authentification du WebSocket de signalisation : origine vérifiée, cookie
 * de session obligatoire, messages validés, taille et débit limités.
 * Vrai serveur HTTP + vrai client ws ; seule la lecture de session est simulée.
 */

import http from "node:http";

import WebSocket from "ws";

import { loadConfiguration } from "../../../src/core/config.js";
import { getSessionCookieName } from "../../../src/core/sessionStore.js";
import {
  CLOSE_CODE_RATE_LIMITED,
  attachCallSignalingWebSocket,
} from "../../../src/controllers/calls/callSignalingSocketController.js";
import { createCallSignalingCoordinator } from "../../../src/services/calls/callSignalingCoordinator.js";

const VALID_SESSION_TOKEN = "a-valid-session-token-of-at-least-32-characters";
const configuration = loadConfiguration("calls");
const sessionCookieHeader = `${getSessionCookieName(configuration.MAIN_APP_COOKIE_SECURE)}=${VALID_SESSION_TOKEN}`;

let httpServer;
let serverUrl;

beforeAll(async () => {
  httpServer = http.createServer((request, response) => response.end());
  const coordinator = createCallSignalingCoordinator({ findCallableAccount: async () => null, recordCallLog: async () => {} });
  attachCallSignalingWebSocket({
    httpServer,
    configuration,
    coordinator,
    findAuthenticatedUserBySessionToken: async (sessionToken) =>
      sessionToken === VALID_SESSION_TOKEN ? { technicianId: 1, username: "alan", role: "technician" } : null,
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  serverUrl = `ws://127.0.0.1:${httpServer.address().port}/api/calls/ws`;
});

afterAll(() => new Promise((resolve) => httpServer.close(resolve)));

/** Ouvre une connexion ; résout avec le statut HTTP de refus, ou avec la connexion ouverte. */
function openConnection(headers) {
  return new Promise((resolve) => {
    const webSocket = new WebSocket(serverUrl, { headers });
    webSocket.on("unexpected-response", (request, response) => resolve({ rejectedWithStatus: response.statusCode }));
    webSocket.on("message", function firstMessage(rawMessage) {
      webSocket.off("message", firstMessage);
      resolve({ webSocket, firstMessage: JSON.parse(rawMessage.toString()) });
    });
    webSocket.on("error", () => {});
  });
}

function waitForMessage(webSocket) {
  return new Promise((resolve) => webSocket.once("message", (rawMessage) => resolve(JSON.parse(rawMessage.toString()))));
}

function waitForClose(webSocket) {
  return new Promise((resolve) => webSocket.once("close", (closeCode) => resolve(closeCode)));
}

describe("WebSocket de signalisation : ouverture", () => {
  test("autre origine : refusé (403), même avec une session valide", async () => {
    const result = await openConnection({ Origin: "https://site-pirate.example", Cookie: sessionCookieHeader });
    expect(result.rejectedWithStatus).toBe(403);
  });

  test("sans en-tête Origin : refusé (403)", async () => {
    expect((await openConnection({ Cookie: sessionCookieHeader })).rejectedWithStatus).toBe(403);
  });

  test("sans cookie ou avec une session invalide : refusé (401)", async () => {
    const origin = configuration.MAIN_APP_PUBLIC_ORIGIN;
    expect((await openConnection({ Origin: origin })).rejectedWithStatus).toBe(401);
    const forgedCookie = `${getSessionCookieName(false)}=forged-token-forged-token-forged-token`;
    expect((await openConnection({ Origin: origin, Cookie: forgedCookie })).rejectedWithStatus).toBe(401);
  });

  test("bonne origine + session valide : connexion acceptée", async () => {
    const { webSocket, firstMessage } = await openConnection({ Origin: configuration.MAIN_APP_PUBLIC_ORIGIN, Cookie: sessionCookieHeader });
    expect(firstMessage).toEqual({ type: "connection.ready" });
    webSocket.close();
  });
});

describe("WebSocket de signalisation : messages", () => {
  async function openAuthenticatedConnection() {
    const { webSocket } = await openConnection({ Origin: configuration.MAIN_APP_PUBLIC_ORIGIN, Cookie: sessionCookieHeader });
    return webSocket;
  }

  test("JSON invalide ou message inconnu : erreur, la connexion reste ouverte", async () => {
    const webSocket = await openAuthenticatedConnection();
    webSocket.send("pas du json");
    expect(await waitForMessage(webSocket)).toMatchObject({ type: "error", code: "invalid_message" });
    webSocket.send(JSON.stringify({ type: "call.offer", callId: "pas-un-uuid", sessionDescription: { type: "offer", sdp: "x" } }));
    expect(await waitForMessage(webSocket)).toMatchObject({ type: "error", code: "invalid_message" });
    webSocket.send(JSON.stringify({ type: "admin.shutdown" }));
    expect(await waitForMessage(webSocket)).toMatchObject({ type: "error", code: "invalid_message" });
    expect(webSocket.readyState).toBe(WebSocket.OPEN);
    webSocket.close();
  });

  test("message trop gros : connexion fermée (1009)", async () => {
    const webSocket = await openAuthenticatedConnection();
    const closePromise = waitForClose(webSocket);
    webSocket.send("x".repeat(64 * 1024));
    expect(await closePromise).toBe(1009);
  });

  test("trop de messages d'un coup : connexion fermée (4429)", async () => {
    const webSocket = await openAuthenticatedConnection();
    const closePromise = waitForClose(webSocket);
    for (let messageNumber = 0; messageNumber < 200; messageNumber += 1) {
      webSocket.send("{}");
    }
    expect(await closePromise).toBe(CLOSE_CODE_RATE_LIMITED);
  });
});
