/**
 * Routes /api/map/... : URL -> middlewares -> controller, rien d'autre.
 * Toutes exigent une session (les tuiles aussi : le relais n'est pas un proxy public).
 */

import { Router } from "express";

import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { requireAuthenticatedUser } from "../../middlewares/requireAuthenticatedUser.js";
import {
  createPoint,
  deletePoint,
  listPointsInBoundingBox,
  listPointsNearLocation,
  readPoint,
  updatePoint,
} from "../../controllers/map/mapPointController.js";
import { readMapSettings, serveTile } from "../../controllers/map/mapTileController.js";
import { readRoute } from "../../controllers/map/routingController.js";

export function createMapRouter() {
  const mapRouter = Router();
  mapRouter.use(requireAuthenticatedUser);

  mapRouter.get("/settings", asyncHandler(readMapSettings));
  mapRouter.post("/route", asyncHandler(readRoute));
  mapRouter.get("/tiles/:z/:x/:y", asyncHandler(serveTile));

  mapRouter.get("/points", asyncHandler(listPointsInBoundingBox));
  mapRouter.get("/points/nearby", asyncHandler(listPointsNearLocation));
  mapRouter.post("/points", asyncHandler(createPoint));
  mapRouter.get("/points/:pointId", asyncHandler(readPoint));
  mapRouter.patch("/points/:pointId", asyncHandler(updatePoint));
  mapRouter.delete("/points/:pointId", asyncHandler(deletePoint));

  return mapRouter;
}
