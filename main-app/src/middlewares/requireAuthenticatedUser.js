/**
 * Exige une session valide et expose req.user = { technicianId, username, role }.
 *
 * L'identité vient UNIQUEMENT du cookie de session vérifié en base : jamais
 * d'un en-tête ou d'un champ envoyé par le client (un en-tête X-User-Id
 * serait trivial à falsifier). Chaque conteneur fait cette vérification
 * lui-même, sans dépendre du conteneur auth.
 */

import { readCookieValue } from "../core/cookies.js";
import { AuthenticationRequiredError } from "../core/errors.js";
import { findAuthenticatedUserBySessionToken, getSessionCookieName } from "../core/sessionStore.js";

export function requireAuthenticatedUser(request, response, next) {
  const sessionCookieName = getSessionCookieName(request.app.locals.configuration.MAIN_APP_COOKIE_SECURE);
  const sessionToken = readCookieValue(request.headers.cookie, sessionCookieName);
  if (!sessionToken) {
    next(new AuthenticationRequiredError());
    return;
  }
  findAuthenticatedUserBySessionToken(sessionToken)
    .then((authenticatedUser) => {
      if (!authenticatedUser) {
        next(new AuthenticationRequiredError("Session expirée. Reconnectez-vous."));
        return;
      }
      request.user = authenticatedUser;
      request.sessionToken = sessionToken;
      next();
    })
    .catch(next);
}
