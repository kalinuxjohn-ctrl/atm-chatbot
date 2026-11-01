/**
 * Règles métier des points de la carte.
 *
 * - Tout utilisateur connecté voit tous les points.
 * - Un technicien modifie et supprime SES points.
 * - moderator et admin gèrent tous les points.
 * Chaque point renvoyé indique `canModify` : la page n'a pas à recalculer
 * les droits (et le serveur les revérifie de toute façon à chaque écriture).
 */

import { AccessDeniedError, ReferenceNotFoundError } from "../../core/errors.js";
import { trace } from "../../core/tracing.js";
import {
  deleteMapPoint,
  findMapPointById,
  findMapPointsInBoundingBox,
  findMapPointsNearLocation,
  insertMapPoint,
  updateMapPoint,
} from "../../models/map/mapPointModel.js";

const ROLES_MANAGING_ALL_POINTS = new Set(["moderator", "admin"]);

function userCanModifyPoint(user, mapPoint) {
  return ROLES_MANAGING_ALL_POINTS.has(user.role) || mapPoint.createdByTechnicianId === user.technicianId;
}

function withModificationRight(user, mapPoint) {
  return { ...mapPoint, canModify: userCanModifyPoint(user, mapPoint) };
}

export async function listMapPointsInVisibleArea(user, boundingBox) {
  return (await findMapPointsInBoundingBox(boundingBox)).map((mapPoint) => withModificationRight(user, mapPoint));
}

export async function listMapPointsAroundLocation(user, { lat, lng, radius }) {
  const nearbyPoints = await findMapPointsNearLocation({ latitude: lat, longitude: lng, radiusMeters: radius });
  return nearbyPoints.map((mapPoint) => withModificationRight(user, mapPoint));
}

async function findMapPointOrFail(pointId) {
  const mapPoint = await findMapPointById(pointId);
  if (!mapPoint) {
    throw new ReferenceNotFoundError("Point introuvable.");
  }
  return mapPoint;
}

export async function readMapPoint(user, pointId) {
  return withModificationRight(user, await findMapPointOrFail(pointId));
}

export async function createMapPoint(user, pointContent) {
  const pointId = await insertMapPoint({ ...pointContent, createdByTechnicianId: user.technicianId });
  trace("MAP", "Point créé", { pointId, category: pointContent.category, technicianId: user.technicianId });
  return readMapPoint(user, pointId);
}

async function findModifiablePointOrFail(user, pointId) {
  const mapPoint = await findMapPointOrFail(pointId);
  if (!userCanModifyPoint(user, mapPoint)) {
    throw new AccessDeniedError("Seul l'auteur du point, un modérateur ou un administrateur peut le modifier.");
  }
  return mapPoint;
}

export async function modifyMapPoint(user, pointId, pointChanges) {
  await findModifiablePointOrFail(user, pointId);
  await updateMapPoint(pointId, pointChanges);
  trace("MAP", "Point modifié", { pointId, technicianId: user.technicianId });
  return readMapPoint(user, pointId);
}

export async function removeMapPoint(user, pointId) {
  await findModifiablePointOrFail(user, pointId);
  await deleteMapPoint(pointId);
  trace("MAP", "Point supprimé", { pointId, technicianId: user.technicianId });
}
