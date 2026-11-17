/**
 * Routes HTTP /api/calls/... : URL -> middlewares -> controller, rien d'autre.
 * Le WebSocket /api/calls/ws est branché à part (callSignalingSocketController.js).
 */

import { Router } from "express";

import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { requireAuthenticatedUser } from "../../middlewares/requireAuthenticatedUser.js";
import { listContacts, listHistory, readCallSettings } from "../../controllers/calls/callController.js";

export function createCallRouter() {
  const callRouter = Router();
  callRouter.use(requireAuthenticatedUser);

  callRouter.get("/settings", asyncHandler(readCallSettings));
  callRouter.get("/contacts", asyncHandler(listContacts));
  callRouter.get("/history", asyncHandler(listHistory));

  return callRouter;
}
