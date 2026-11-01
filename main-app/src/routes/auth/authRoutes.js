/**
 * Routes /api/auth/... : URL -> middlewares -> controller, rien d'autre.
 */

import { Router } from "express";

import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { requireAuthenticatedUser } from "../../middlewares/requireAuthenticatedUser.js";
import { requireRole } from "../../middlewares/requireRole.js";
import {
  listAllAccounts,
  createNewAccount,
  resetPasswordOfAccount,
  updateActiveStateOfAccount,
  updateRoleOfAccount,
} from "../../controllers/auth/accountAdministrationController.js";
import {
  changeCurrentUserPassword,
  logIn,
  logOutCurrentSession,
  readCurrentUser,
  readRegistrationAvailability,
  register,
} from "../../controllers/auth/authenticationController.js";

export function createAuthRouter() {
  const authRouter = Router();

  authRouter.post("/login", asyncHandler(logIn));
  authRouter.get("/registration", asyncHandler(readRegistrationAvailability));
  authRouter.post("/register", asyncHandler(register));

  authRouter.post("/logout", requireAuthenticatedUser, asyncHandler(logOutCurrentSession));
  authRouter.get("/me", requireAuthenticatedUser, asyncHandler(readCurrentUser));
  authRouter.post("/me/password", requireAuthenticatedUser, asyncHandler(changeCurrentUserPassword));

  const administratorOnly = [requireAuthenticatedUser, requireRole("admin")];
  authRouter.get("/accounts", ...administratorOnly, asyncHandler(listAllAccounts));
  authRouter.post("/accounts", ...administratorOnly, asyncHandler(createNewAccount));
  authRouter.put("/accounts/:technicianId/role", ...administratorOnly, asyncHandler(updateRoleOfAccount));
  authRouter.put("/accounts/:technicianId/active", ...administratorOnly, asyncHandler(updateActiveStateOfAccount));
  authRouter.put("/accounts/:technicianId/password", ...administratorOnly, asyncHandler(resetPasswordOfAccount));

  return authRouter;
}
