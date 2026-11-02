/**
 * Exige une session valide et expose req.user = { technicianId, username, role }.
 *
 * L'identité vient UNIQUEMENT du cookie de session vérifié en base : jamais
 * d'un en-tête ou d'un champ envoyé par le client (un en-tête X-User-Id
 * serait trivial à falsifier). Chaque conteneur fait cette vérification
 * lui-même, sans dépendre du conteneur auth.
 *
 * Exception de DÉVELOPPEMENT : si MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME est
 * défini (refusé en production par config.js), une requête sans session
 * valide est traitée comme venant de ce compte. Une vraie session reste
 * prioritaire, ce qui permet de tester à deux comptes.
 */

import { readCookieValue } from "../core/cookies.js";
import { AuthenticationRequiredError } from "../core/errors.js";
import {
  findActiveAccountForDevelopmentAutoLogin,
  findAuthenticatedUserBySessionToken,
  getSessionCookieName,
} from "../core/sessionStore.js";

export function requireAuthenticatedUser(request, response, next) {
  const { MAIN_APP_COOKIE_SECURE, MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME } = request.app.locals.configuration;
  const sessionToken = readCookieValue(request.headers.cookie, getSessionCookieName(MAIN_APP_COOKIE_SECURE));

  (async () => {
    const sessionUser = sessionToken ? await findAuthenticatedUserBySessionToken(sessionToken) : null;
    if (sessionUser) {
      request.user = sessionUser;
      request.sessionToken = sessionToken;
      return next();
    }
    if (MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME) {
      const developmentUser = await findActiveAccountForDevelopmentAutoLogin(MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME);
      if (developmentUser) {
        request.user = developmentUser;
        return next();
      }
    }
    return next(
      sessionToken ? new AuthenticationRequiredError("Session expirée. Reconnectez-vous.") : new AuthenticationRequiredError(),
    );
  })().catch(next);
}
