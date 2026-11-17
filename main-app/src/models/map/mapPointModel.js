/**
 * Accès SQL aux points de la carte (main_app.points_carte).
 * Le nom de l'auteur vient de main_app.comptes (nom d'utilisateur affiché).
 */

import { queryDatabase } from "../../core/database.js";

// Nombre maximal de points renvoyés en une fois : borne la taille de la
// réponse même si la zone visible couvre tout un pays.
export const MAXIMUM_POINTS_PER_REQUEST = 500;

const MAP_POINT_COLUMNS = `
  points.id, points.title, points.description, points.category, points.latitude, points.longitude,
  points.created_by, points.created_at, points.updated_at, accounts.username AS created_by_username`;

const MAP_POINT_SOURCE = `
  main_app.points_carte AS points
  LEFT JOIN main_app.comptes AS accounts ON accounts.technician_id = points.created_by`;

function toMapPoint(pointRow) {
  return {
    id: pointRow.id,
    title: pointRow.title,
    description: pointRow.description,
    category: pointRow.category,
    latitude: pointRow.latitude,
    longitude: pointRow.longitude,
    createdByTechnicianId: pointRow.created_by,
    createdByUsername: pointRow.created_by_username ?? null,
    createdAt: pointRow.created_at,
    updatedAt: pointRow.updated_at,
    ...(pointRow.distance_meters !== undefined ? { distanceMeters: Math.round(pointRow.distance_meters) } : {}),
  };
}

export async function findMapPointById(pointId) {
  const [pointRow] = await queryDatabase(`SELECT ${MAP_POINT_COLUMNS} FROM ${MAP_POINT_SOURCE} WHERE points.id = $1`, [pointId]);
  return pointRow ? toMapPoint(pointRow) : null;
}

/**
 * Points de la zone visible. Si west > east, la zone traverse l'antiméridien :
 * on prend alors les longitudes >= west OU <= east.
 */
export async function findMapPointsInBoundingBox({ south, west, north, east }) {
  const pointRows = await queryDatabase(
    `SELECT ${MAP_POINT_COLUMNS} FROM ${MAP_POINT_SOURCE}
      WHERE points.latitude BETWEEN $1::float8 AND $2::float8
        AND (CASE WHEN $3::float8 <= $4::float8
                  THEN points.longitude BETWEEN $3::float8 AND $4::float8
                  ELSE points.longitude >= $3::float8 OR points.longitude <= $4::float8 END)
      ORDER BY points.updated_at DESC
      LIMIT ${MAXIMUM_POINTS_PER_REQUEST}`,
    [south, north, west, east],
  );
  return pointRows.map(toMapPoint);
}

/**
 * Points à moins de `radiusMeters` du centre, du plus proche au plus loin.
 * earth_box (index GiST) élimine vite les points trop loin ; earth_distance
 * garde ensuite seulement ceux vraiment dans le cercle.
 */
export async function findMapPointsNearLocation({ latitude, longitude, radiusMeters }) {
  const pointRows = await queryDatabase(
    `SELECT ${MAP_POINT_COLUMNS},
            earth_distance(ll_to_earth($1::float8, $2::float8), ll_to_earth(points.latitude, points.longitude)) AS distance_meters
       FROM ${MAP_POINT_SOURCE}
      WHERE earth_box(ll_to_earth($1::float8, $2::float8), $3::float8) @> ll_to_earth(points.latitude, points.longitude)
        AND earth_distance(ll_to_earth($1::float8, $2::float8), ll_to_earth(points.latitude, points.longitude)) <= $3::float8
      ORDER BY distance_meters
      LIMIT ${MAXIMUM_POINTS_PER_REQUEST}`,
    [latitude, longitude, radiusMeters],
  );
  return pointRows.map(toMapPoint);
}

export async function insertMapPoint({ title, description, category, latitude, longitude, createdByTechnicianId }) {
  const [createdRow] = await queryDatabase(
    `INSERT INTO main_app.points_carte (title, description, category, latitude, longitude, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [title, description, category, latitude, longitude, createdByTechnicianId],
  );
  return createdRow.id;
}

/** Ne modifie que les champs fournis (COALESCE : null = garder la valeur actuelle). */
export async function updateMapPoint(pointId, { title, description, category, latitude, longitude }) {
  await queryDatabase(
    `UPDATE main_app.points_carte SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        category = COALESCE($4::main_app.map_point_category, category),
        latitude = COALESCE($5, latitude),
        longitude = COALESCE($6, longitude),
        updated_at = now()
      WHERE id = $1`,
    [pointId, title ?? null, description ?? null, category ?? null, latitude ?? null, longitude ?? null],
  );
}

export async function deleteMapPoint(pointId) {
  await queryDatabase("DELETE FROM main_app.points_carte WHERE id = $1", [pointId]);
}
