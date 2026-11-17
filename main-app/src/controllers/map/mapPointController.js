/**
 * Points de la carte : lecture de la requête, appel du service, réponse JSON.
 */

import { parseWithSchema } from "../../core/validation.js";
import {
  boundingBoxQuerySchema,
  mapPointCreationSchema,
  mapPointIdParametersSchema,
  mapPointUpdateSchema,
  proximityQuerySchema,
} from "../../schemas/map/mapSchemas.js";
import {
  createMapPoint,
  listMapPointsAroundLocation,
  listMapPointsInVisibleArea,
  modifyMapPoint,
  readMapPoint,
  removeMapPoint,
} from "../../services/map/mapPointService.js";

export async function listPointsInBoundingBox(request, response) {
  const boundingBox = parseWithSchema(boundingBoxQuerySchema, request.query);
  response.json({ points: await listMapPointsInVisibleArea(request.user, boundingBox) });
}

export async function listPointsNearLocation(request, response) {
  const proximity = parseWithSchema(proximityQuerySchema, request.query);
  response.json({ points: await listMapPointsAroundLocation(request.user, proximity) });
}

export async function readPoint(request, response) {
  const { pointId } = parseWithSchema(mapPointIdParametersSchema, request.params);
  response.json({ point: await readMapPoint(request.user, pointId) });
}

export async function createPoint(request, response) {
  const pointContent = parseWithSchema(mapPointCreationSchema, request.body);
  response.status(201).json({ point: await createMapPoint(request.user, pointContent) });
}

export async function updatePoint(request, response) {
  const { pointId } = parseWithSchema(mapPointIdParametersSchema, request.params);
  const pointChanges = parseWithSchema(mapPointUpdateSchema, request.body);
  response.json({ point: await modifyMapPoint(request.user, pointId, pointChanges) });
}

export async function deletePoint(request, response) {
  const { pointId } = parseWithSchema(mapPointIdParametersSchema, request.params);
  await removeMapPoint(request.user, pointId);
  response.status(204).end();
}
