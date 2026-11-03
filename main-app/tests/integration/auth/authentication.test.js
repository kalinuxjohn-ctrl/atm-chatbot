/**
 * Authentification et rôles, contre une vraie base : connexion, verrouillage,
 * sessions, inscription, administration des comptes.
 */

import request from "supertest";

import { loadConfiguration } from "../../../src/core/config.js";
import { createFeatureApp } from "../../../src/core/createFeatureApp.js";
import { getSessionCookieName } from "../../../src/core/sessionStore.js";
import { createAuthRouter } from "../../../src/routes/auth/authRoutes.js";
import { createAccount } from "../../../src/services/auth/accountAdministrationService.js";
import {
  TEST_PASSWORD,
  connectToTestDatabase,
  createAccountWithSession,
  createUniqueUsername,
  describeWithDatabase,
  sendAs,
} from "../integrationTestHelpers.js";

const SESSION_COOKIE_NAME = getSessionCookieName(false);

function createAuthApp() {
  return createFeatureApp({ featureName: "auth", configuration: loadConfiguration("auth"), apiRouter: createAuthRouter() });
}

function extractSessionCookie(response) {
  const sessionCookie = (response.headers["set-cookie"] ?? []).find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  return sessionCookie ? sessionCookie.split(";")[0] : null;
}

describeWithDatabase("authentification", () => {
  connectToTestDatabase();
  const authApp = createAuthApp();

  test("connexion réussie : cookie httpOnly SameSite=Lax, puis /me renvoie l'utilisateur", async () => {
    const username = createUniqueUsername("login");
    await createAccount({ username, password: TEST_PASSWORD, role: "technician", fullName: "Alan Test" });

    const loginResponse = await request(authApp).post("/api/auth/login").send({ username, password: TEST_PASSWORD });
    expect(loginResponse.status).toBe(200);
    const rawCookie = loginResponse.headers["set-cookie"].join(";");
    expect(rawCookie).toMatch(/HttpOnly/i);
    expect(rawCookie).toMatch(/SameSite=Lax/i);
    expect(loginResponse.body.user).toMatchObject({ username, role: "technician" });
    expect(JSON.stringify(loginResponse.body)).not.toMatch(/password|hash/i);

    const meResponse = await request(authApp).get("/api/auth/me").set("Cookie", extractSessionCookie(loginResponse));
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user).toMatchObject({ username, fullName: "Alan Test" });
  });

  test("le nom d'utilisateur est insensible à la casse", async () => {
    const username = createUniqueUsername("case");
    await createAccount({ username, password: TEST_PASSWORD, role: "technician", fullName: "Casse" });
    const loginResponse = await request(authApp).post("/api/auth/login").send({ username: username.toUpperCase(), password: TEST_PASSWORD });
    expect(loginResponse.status).toBe(200);
  });

  test("même erreur générique pour un mauvais mot de passe et un compte inexistant", async () => {
    const username = createUniqueUsername("generic");
    await createAccount({ username, password: TEST_PASSWORD, role: "technician", fullName: "Générique" });

    const wrongPasswordResponse = await request(authApp).post("/api/auth/login").send({ username, password: "wrong-password!" });
    const unknownUserResponse = await request(authApp)
      .post("/api/auth/login")
      .send({ username: createUniqueUsername("nobody"), password: "wrong-password!" });
    expect(wrongPasswordResponse.status).toBe(401);
    expect(unknownUserResponse.status).toBe(401);
    expect(wrongPasswordResponse.body).toEqual(unknownUserResponse.body);
  });

  test("verrouillage temporaire après trop d'échecs, même avec le bon mot de passe ensuite", async () => {
    const username = createUniqueUsername("lock");
    await createAccount({ username, password: TEST_PASSWORD, role: "technician", fullName: "Verrou" });
    // MAIN_APP_LOGIN_MAX_FAILED_ATTEMPTS = 3 dans les tests.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(authApp).post("/api/auth/login").send({ username, password: "wrong-password!" });
    }
    const lockedResponse = await request(authApp).post("/api/auth/login").send({ username, password: TEST_PASSWORD });
    expect(lockedResponse.status).toBe(429);
    expect(extractSessionCookie(lockedResponse)).toBeNull();
  });

  test("un compte désactivé ne peut pas se connecter (message générique)", async () => {
    const administrator = await createAccountWithSession({ role: "admin" });
    const technician = await createAccountWithSession({ role: "technician" });
    await sendAs(authApp, administrator).put(`/api/auth/accounts/${technician.technicianId}/active`).send({ isActive: false });

    const loginResponse = await request(authApp).post("/api/auth/login").send({ username: technician.username, password: TEST_PASSWORD });
    expect(loginResponse.status).toBe(401);
    // Sa session ouverte avant la désactivation est coupée immédiatement.
    expect((await sendAs(authApp, technician).get("/api/auth/me")).status).toBe(401);
  });

  test("sans cookie, ou avec un cookie inventé : 401", async () => {
    expect((await request(authApp).get("/api/auth/me")).status).toBe(401);
    const forgedResponse = await request(authApp).get("/api/auth/me").set("Cookie", `${SESSION_COOKIE_NAME}=${"a".repeat(43)}`);
    expect(forgedResponse.status).toBe(401);
  });

  test("un en-tête d'identité envoyé par le client est ignoré", async () => {
    const forgedIdentityResponse = await request(authApp).get("/api/auth/me").set("X-User-Id", "1").set("X-Technician-Id", "1");
    expect(forgedIdentityResponse.status).toBe(401);
  });

  test("déconnexion : la session est supprimée en base", async () => {
    const technician = await createAccountWithSession();
    expect((await sendAs(authApp, technician).post("/api/auth/logout")).status).toBe(204);
    expect((await sendAs(authApp, technician).get("/api/auth/me")).status).toBe(401);
  });

  test("inscription libre (activée dans les tests) puis nom déjà pris -> 409", async () => {
    const username = createUniqueUsername("signup");
    const registrationResponse = await request(authApp).post("/api/auth/register").send({ username, password: TEST_PASSWORD });
    expect(registrationResponse.status).toBe(201);
    expect(extractSessionCookie(registrationResponse)).not.toBeNull();

    const duplicateResponse = await request(authApp).post("/api/auth/register").send({ username, password: TEST_PASSWORD });
    expect(duplicateResponse.status).toBe(409);
  });

  test("règles du nom et du mot de passe : 422", async () => {
    const tooShortPassword = await request(authApp).post("/api/auth/register").send({ username: createUniqueUsername(), password: "short" });
    const invalidUsername = await request(authApp).post("/api/auth/register").send({ username: "a b<script>", password: TEST_PASSWORD });
    expect(tooShortPassword.status).toBe(422);
    expect(invalidUsername.status).toBe(422);
  });

  test("changement de son mot de passe : l'ancien ne marche plus, les autres sessions sont fermées", async () => {
    const technician = await createAccountWithSession();
    const otherDeviceLogin = await request(authApp).post("/api/auth/login").send({ username: technician.username, password: TEST_PASSWORD });
    const otherDeviceCookie = extractSessionCookie(otherDeviceLogin);

    const changeResponse = await sendAs(authApp, technician)
      .post("/api/auth/me/password")
      .send({ currentPassword: TEST_PASSWORD, newPassword: "a-brand-new-password" });
    expect(changeResponse.status).toBe(204);
    expect((await sendAs(authApp, technician).get("/api/auth/me")).status).toBe(200);
    expect((await request(authApp).get("/api/auth/me").set("Cookie", otherDeviceCookie)).status).toBe(401);
    const oldPasswordLogin = await request(authApp).post("/api/auth/login").send({ username: technician.username, password: TEST_PASSWORD });
    expect(oldPasswordLogin.status).toBe(401);
  });
});

describeWithDatabase("administration des comptes et rôles", () => {
  connectToTestDatabase();
  const authApp = createAuthApp();

  test("un technicien et un modérateur n'ont pas accès à l'administration (403)", async () => {
    for (const role of ["technician", "moderator"]) {
      const account = await createAccountWithSession({ role });
      expect((await sendAs(authApp, account).get("/api/auth/accounts")).status).toBe(403);
      const creationResponse = await sendAs(authApp, account)
        .post("/api/auth/accounts")
        .send({ username: createUniqueUsername(), password: TEST_PASSWORD, fullName: "Intrus" });
      expect(creationResponse.status).toBe(403);
    }
  });

  test("contrôle admin du gateway (administration du Copilote) : 204 admin, 403 autres rôles, 401 sans session", async () => {
    const checkPath = "/api/auth/internal/administrator-check";
    expect((await sendAs(authApp, await createAccountWithSession({ role: "admin" })).get(checkPath)).status).toBe(204);
    for (const role of ["technician", "moderator"]) {
      expect((await sendAs(authApp, await createAccountWithSession({ role })).get(checkPath)).status).toBe(403);
    }
    expect((await request(authApp).get(checkPath)).status).toBe(401);
  });

  test("un admin crée un compte avec un nouveau technicien, puis change son rôle", async () => {
    const administrator = await createAccountWithSession({ role: "admin" });
    const username = createUniqueUsername("created");
    const creationResponse = await sendAs(authApp, administrator)
      .post("/api/auth/accounts")
      .send({ username, password: TEST_PASSWORD, fullName: "Nouveau Technicien" });
    expect(creationResponse.status).toBe(201);
    const { technicianId } = creationResponse.body.account;

    const roleResponse = await sendAs(authApp, administrator).put(`/api/auth/accounts/${technicianId}/role`).send({ role: "moderator" });
    expect(roleResponse.status).toBe(200);
    expect(roleResponse.body.account.role).toBe("moderator");
  });

  test("rattacher un compte à un technicien existant : une seule fois", async () => {
    const administrator = await createAccountWithSession({ role: "admin" });
    const existingTechnician = await createAccountWithSession();
    const secondAccountResponse = await sendAs(authApp, administrator)
      .post("/api/auth/accounts")
      .send({ username: createUniqueUsername(), password: TEST_PASSWORD, existingTechnicianId: existingTechnician.technicianId });
    expect(secondAccountResponse.status).toBe(409);

    const unknownTechnicianResponse = await sendAs(authApp, administrator)
      .post("/api/auth/accounts")
      .send({ username: createUniqueUsername(), password: TEST_PASSWORD, existingTechnicianId: 2_000_000_000 });
    expect(unknownTechnicianResponse.status).toBe(404);
  });

  test("un admin ne peut pas modifier son propre rôle", async () => {
    const administrator = await createAccountWithSession({ role: "admin" });
    const ownRoleResponse = await sendAs(authApp, administrator)
      .put(`/api/auth/accounts/${administrator.technicianId}/role`)
      .send({ role: "technician" });
    expect(ownRoleResponse.status).toBe(409);
  });

  test("réinitialisation du mot de passe par un admin : sessions du compte fermées", async () => {
    const administrator = await createAccountWithSession({ role: "admin" });
    const technician = await createAccountWithSession();
    const resetResponse = await sendAs(authApp, administrator)
      .put(`/api/auth/accounts/${technician.technicianId}/password`)
      .send({ newPassword: "reset-by-the-admin" });
    expect(resetResponse.status).toBe(204);
    expect((await sendAs(authApp, technician).get("/api/auth/me")).status).toBe(401);
    const loginResponse = await request(authApp).post("/api/auth/login").send({ username: technician.username, password: "reset-by-the-admin" });
    expect(loginResponse.status).toBe(200);
  });
});
