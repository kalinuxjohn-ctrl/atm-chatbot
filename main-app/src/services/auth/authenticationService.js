/**
 * Connexion, déconnexion, inscription libre et changement de son mot de passe.
 *
 * Protection contre la découverte des comptes et la force brute :
 * - même message d'erreur que le nom existe ou non, que le compte soit
 *   désactivé ou que le mot de passe soit faux ;
 * - même temps de réponse : un mot de passe est toujours vérifié, contre
 *   une empreinte leurre si le compte n'existe pas ;
 * - verrouillage temporaire après N échecs pour un couple (nom saisi, IP).
 */

import { AccessDeniedError, AuthenticationRequiredError, TooManyAttemptsError } from "../../core/errors.js";
import { createSessionForTechnician, deleteSessionByToken, deleteSessionsOfTechnician } from "../../core/sessionStore.js";
import { trace } from "../../core/tracing.js";
import {
  findAccountByTechnicianId,
  findAccountCredentialsByUsername,
  findPasswordHashByTechnicianId,
  recordFailedLoginOnAccount,
  recordSuccessfulLogin,
  updateAccountPasswordHash,
} from "../../models/auth/accountModel.js";
import { clearFailedAttempts, findActiveLockEnd, recordFailedAttempt } from "../../models/auth/loginThrottleModel.js";
import { createAccount } from "./accountAdministrationService.js";
import { getDecoyPasswordHash, hashPassword, passwordMatchesHash } from "./passwordHashingService.js";

const INVALID_CREDENTIALS_MESSAGE = "Nom d'utilisateur ou mot de passe incorrect.";

export async function logInWithUsernameAndPassword({ username, password, ipAddress, userAgent }, configuration) {
  const throttleSettings = {
    maximumFailedAttempts: configuration.MAIN_APP_LOGIN_MAX_FAILED_ATTEMPTS,
    lockMinutes: configuration.MAIN_APP_LOGIN_LOCK_MINUTES,
  };

  if (await findActiveLockEnd(username, ipAddress)) {
    // Même pendant le verrouillage, on fait le travail de vérification : la
    // durée de la réponse ne dit pas si le mot de passe était bon.
    await passwordMatchesHash(password, await getDecoyPasswordHash());
    trace("AUTH", "Connexion refusée : verrouillage temporaire en cours");
    throw new TooManyAttemptsError();
  }

  const account = await findAccountCredentialsByUsername(username);
  const passwordIsCorrect = await passwordMatchesHash(password, account?.passwordHash ?? (await getDecoyPasswordHash()));

  if (!account || !passwordIsCorrect || !account.isActive) {
    await recordFailedAttempt(username, ipAddress, throttleSettings);
    if (account) {
      await recordFailedLoginOnAccount(account.technicianId);
    }
    trace("AUTH", "Échec de connexion", { accountExists: Boolean(account) });
    throw new AuthenticationRequiredError(INVALID_CREDENTIALS_MESSAGE);
  }

  await clearFailedAttempts(username, ipAddress);
  await recordSuccessfulLogin(account.technicianId);
  const { sessionToken, expiresAt } = await createSessionForTechnician({
    technicianId: account.technicianId,
    sessionDurationHours: configuration.MAIN_APP_SESSION_DURATION_HOURS,
    ipAddress,
    userAgent,
  });
  trace("AUTH", "Connexion réussie", { technicianId: account.technicianId });
  return {
    sessionToken,
    expiresAt,
    user: { technicianId: account.technicianId, username: account.username, role: account.role },
  };
}

export async function logOut(sessionToken) {
  await deleteSessionByToken(sessionToken);
}

/** Inscription libre : désactivée par défaut (MAIN_APP_ALLOW_REGISTRATION=false). */
export async function registerOwnAccount({ username, password, fullName, ipAddress, userAgent }, configuration) {
  if (!configuration.MAIN_APP_ALLOW_REGISTRATION) {
    throw new AccessDeniedError("L'inscription libre est désactivée : demandez un compte à un administrateur.");
  }
  const technicianId = await createAccount({ username, password, role: "technician", fullName: fullName ?? username });
  const { sessionToken, expiresAt } = await createSessionForTechnician({
    technicianId,
    sessionDurationHours: configuration.MAIN_APP_SESSION_DURATION_HOURS,
    ipAddress,
    userAgent,
  });
  return { sessionToken, expiresAt, user: { technicianId, username, role: "technician" } };
}

export async function findProfileOfUser(user) {
  return findAccountByTechnicianId(user.technicianId);
}

/** Changement de SON mot de passe : les autres appareils sont déconnectés, pas celui-ci. */
export async function changeOwnPassword(user, { currentPassword, newPassword }, currentSessionToken) {
  const passwordHash = await findPasswordHashByTechnicianId(user.technicianId);
  if (!(await passwordMatchesHash(currentPassword, passwordHash ?? (await getDecoyPasswordHash())))) {
    throw new AccessDeniedError("Mot de passe actuel incorrect.");
  }
  await updateAccountPasswordHash(user.technicianId, await hashPassword(newPassword));
  await deleteSessionsOfTechnician(user.technicianId, { keepSessionToken: currentSessionToken });
  trace("AUTH", "Mot de passe changé par son titulaire", { technicianId: user.technicianId });
}
