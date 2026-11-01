/**
 * Outils communs aux tests d'intégration : vraie base (migrations 0001 à
 * 0018 appliquées), vraies apps Express, appelées avec supertest.
 *
 * Chaque test crée ses propres comptes avec un nom unique : pas besoin de
 * vider les tables entre deux tests (et main_app_user n'a de toute façon pas
 * le droit de supprimer des lignes de public.technician).
 */

import { randomBytes } from "node:crypto";

import request from "supertest";

import { loadConfiguration } from "../../src/core/config.js";
import { closeDatabasePool, initializeDatabasePool } from "../../src/core/database.js";
import { createSessionForTechnician, getSessionCookieName } from "../../src/core/sessionStore.js";
import { createAccount } from "../../src/services/auth/accountAdministrationService.js";

export const integrationDatabaseIsConfigured = Boolean(process.env.MAIN_APP_TEST_DATABASE_HOST);

/** describe() qui ne tourne que si une base de test est configurée. */
export const describeWithDatabase = integrationDatabaseIsConfigured ? describe : describe.skip;

export function connectToTestDatabase() {
  beforeAll(() => {
    initializeDatabasePool(loadConfiguration("jobs"));
  });
  afterAll(async () => {
    await closeDatabasePool();
  });
}

export function createUniqueUsername(prefix = "user") {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

export const TEST_PASSWORD = "correct-horse-battery";

/** Crée un compte et une session : renvoie le compte et l'en-tête Cookie à envoyer. */
export async function createAccountWithSession({ role = "technician", usernamePrefix = role } = {}) {
  const username = createUniqueUsername(usernamePrefix);
  const technicianId = await createAccount({ username, password: TEST_PASSWORD, role, fullName: `Test ${username}` });
  const { sessionToken } = await createSessionForTechnician({ technicianId, sessionDurationHours: 1, ipAddress: "127.0.0.1" });
  const sessionCookieName = getSessionCookieName(false);
  return { technicianId, username, role, sessionToken, cookieHeader: `${sessionCookieName}=${sessionToken}` };
}

/** Requête supertest avec une origine identique à l'hôte (comme un navigateur sur notre site). */
export function sendAs(featureApp, account) {
  const agent = request(featureApp);
  const withSession = (pendingRequest) => (account ? pendingRequest.set("Cookie", account.cookieHeader) : pendingRequest);
  return {
    get: (path) => withSession(agent.get(path)),
    post: (path) => withSession(agent.post(path)),
    put: (path) => withSession(agent.put(path)),
    delete: (path) => withSession(agent.delete(path)),
  };
}
