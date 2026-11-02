/**
 * Connexion automatique de DÉVELOPPEMENT (MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME) :
 * sans session, les requêtes agissent en tant que ce compte ; une vraie
 * session reste prioritaire ; un compte absent ou désactivé ne donne rien.
 */

import { loadConfiguration } from "../../../src/core/config.js";
import { createFeatureApp } from "../../../src/core/createFeatureApp.js";
import { updateAccountActiveState } from "../../../src/models/auth/accountModel.js";
import { createAuthRouter } from "../../../src/routes/auth/authRoutes.js";
import { connectToTestDatabase, createAccountWithSession, createUniqueUsername, describeWithDatabase, sendAs } from "../integrationTestHelpers.js";

function createAuthAppWithAutoLogin(autoLoginUsername) {
  const configuration = { ...loadConfiguration("auth"), MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME: autoLoginUsername };
  return createFeatureApp({ featureName: "auth", configuration, apiRouter: createAuthRouter() });
}

describeWithDatabase("connexion automatique de développement", () => {
  connectToTestDatabase();

  test("sans session : la requête agit en tant que le compte configuré", async () => {
    const autoLoginAccount = await createAccountWithSession({ role: "admin" });
    const authApp = createAuthAppWithAutoLogin(autoLoginAccount.username);

    const currentUserResponse = await sendAs(authApp, null).get("/api/auth/me");
    expect(currentUserResponse.status).toBe(200);
    expect(currentUserResponse.body.user).toMatchObject({ username: autoLoginAccount.username, role: "admin" });
  });

  test("une vraie session reste prioritaire (tests à deux comptes)", async () => {
    const autoLoginAccount = await createAccountWithSession();
    const colleague = await createAccountWithSession();
    const authApp = createAuthAppWithAutoLogin(autoLoginAccount.username);

    const currentUserResponse = await sendAs(authApp, colleague).get("/api/auth/me");
    expect(currentUserResponse.body.user.username).toBe(colleague.username);
  });

  test("compte inexistant ou désactivé : 401 comme sans connexion automatique", async () => {
    expect((await sendAs(createAuthAppWithAutoLogin(createUniqueUsername("absent")), null).get("/api/auth/me")).status).toBe(401);

    const deactivatedAccount = await createAccountWithSession();
    await updateAccountActiveState(deactivatedAccount.technicianId, false);
    expect((await sendAs(createAuthAppWithAutoLogin(deactivatedAccount.username), null).get("/api/auth/me")).status).toBe(401);
  });
});
