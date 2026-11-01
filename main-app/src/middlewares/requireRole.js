/**
 * Exige l'un des rôles donnés. À placer APRÈS requireAuthenticatedUser.
 *
 *   router.post("/accounts", requireAuthenticatedUser, requireRole("admin"), ...)
 */

import { AccessDeniedError, AuthenticationRequiredError } from "../core/errors.js";

export function requireRole(...allowedRoles) {
  return function checkUserRole(request, response, next) {
    if (!request.user) {
      next(new AuthenticationRequiredError());
      return;
    }
    if (!allowedRoles.includes(request.user.role)) {
      next(new AccessDeniedError());
      return;
    }
    next();
  };
}
