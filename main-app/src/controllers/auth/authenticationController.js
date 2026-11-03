/**
 * Connexion, déconnexion, inscription, profil : lit la requête, appelle le
 * service, pose ou efface le cookie de session, renvoie le JSON.
 */

import { getSessionCookieName } from "../../core/sessionStore.js";
import { parseWithSchema } from "../../core/validation.js";
import {
  loginRequestSchema,
  passwordChangeRequestSchema,
  registrationRequestSchema,
} from "../../schemas/auth/authSchemas.js";
import {
  changeOwnPassword,
  findProfileOfUser,
  logInWithUsernameAndPassword,
  logOut,
  registerOwnAccount,
} from "../../services/auth/authenticationService.js";

function readClientNetworkDetails(request) {
  // req.ip : adresse transmise par le gateway (trust proxy, voir createFeatureApp).
  return { ipAddress: request.ip ?? "0.0.0.0", userAgent: request.get("user-agent") ?? null };
}

/**
 * Cookie de session : httpOnly (illisible par le JavaScript, donc par un
 * éventuel script injecté), Secure (HTTPS seulement), SameSite=Lax (pas
 * envoyé par les formulaires d'un autre site : protège du CSRF).
 */
function setSessionCookie(request, response, sessionToken, expiresAt) {
  const { MAIN_APP_COOKIE_SECURE } = request.app.locals.configuration;
  response.cookie(getSessionCookieName(MAIN_APP_COOKIE_SECURE), sessionToken, {
    httpOnly: true,
    secure: MAIN_APP_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

function clearSessionCookie(request, response) {
  const { MAIN_APP_COOKIE_SECURE } = request.app.locals.configuration;
  response.clearCookie(getSessionCookieName(MAIN_APP_COOKIE_SECURE), {
    httpOnly: true,
    secure: MAIN_APP_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
}

export async function logIn(request, response) {
  const credentials = parseWithSchema(loginRequestSchema, request.body);
  const { sessionToken, expiresAt, user } = await logInWithUsernameAndPassword(
    { ...credentials, ...readClientNetworkDetails(request) },
    request.app.locals.configuration,
  );
  setSessionCookie(request, response, sessionToken, expiresAt);
  response.json({ user });
}

export async function logOutCurrentSession(request, response) {
  await logOut(request.sessionToken);
  clearSessionCookie(request, response);
  response.status(204).end();
}

export async function register(request, response) {
  const registration = parseWithSchema(registrationRequestSchema, request.body);
  const { sessionToken, expiresAt, user } = await registerOwnAccount(
    { ...registration, ...readClientNetworkDetails(request) },
    request.app.locals.configuration,
  );
  setSessionCookie(request, response, sessionToken, expiresAt);
  response.status(201).json({ user });
}

/** La page d'inscription demande d'abord si l'inscription libre est ouverte. */
export function readRegistrationAvailability(request, response) {
  response.json({ registrationAllowed: request.app.locals.configuration.MAIN_APP_ALLOW_REGISTRATION });
}

export async function readCurrentUser(request, response) {
  const profile = await findProfileOfUser(request.user);
  response.json({ user: { ...request.user, fullName: profile?.fullName ?? null } });
}

/** Réponse au contrôle auth_request du gateway : la session (et le rôle admin) ont déjà été vérifiés par les middlewares. */
export function confirmAdministratorSession(request, response) {
  response.status(204).end();
}

export async function changeCurrentUserPassword(request, response) {
  const passwordChange = parseWithSchema(passwordChangeRequestSchema, request.body);
  await changeOwnPassword(request.user, passwordChange, request.sessionToken);
  response.status(204).end();
}
