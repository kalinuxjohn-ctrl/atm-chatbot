/**
 * Validation des entrées de la carte : coordonnées, zone visible, rayon,
 * contenu d'un point, coordonnées de tuile.
 *
 * Titre et description sont du TEXTE BRUT (affichés avec textContent) : on
 * n'y retire rien, mais on refuse les caractères de contrôle invisibles.
 */

import { z } from "zod";

export const MAP_POINT_CATEGORIES = ["atm_site", "tpe_client", "parts_depot", "difficult_access", "other"];

// Caractères de contrôle (sauf retour à la ligne) et caractères de direction
// du texte : invisibles, ils servent à maquiller un texte affiché.
// eslint-disable-next-line no-control-regex -- c'est justement le but : détecter ces caractères.
const FORBIDDEN_INVISIBLE_CHARACTERS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/u;

function plainTextSchema(maximumLength, { allowLineBreaks }) {
  return z
    .string()
    .transform((text) => text.replace(/\r\n?/g, "\n").trim())
    .refine((text) => !FORBIDDEN_INVISIBLE_CHARACTERS.test(text), "caractères de contrôle interdits")
    .refine((text) => allowLineBreaks || !text.includes("\n"), "une seule ligne")
    // Longueur en caractères affichés (un emoji = 1), pas en unités UTF-16.
    .refine((text) => [...text].length <= maximumLength, `${maximumLength} caractères maximum`);
}

const latitudeSchema = z.coerce.number().min(-90, "latitude entre -90 et 90").max(90, "latitude entre -90 et 90");
const longitudeSchema = z.coerce.number().min(-180, "longitude entre -180 et 180").max(180, "longitude entre -180 et 180");

export const mapPointCreationSchema = z.object({
  title: plainTextSchema(120, { allowLineBreaks: false }).refine((title) => title.length > 0, "obligatoire"),
  description: plainTextSchema(2000, { allowLineBreaks: true }).default(""),
  category: z.enum(MAP_POINT_CATEGORIES).default("other"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** Modification : tous les champs sont facultatifs, au moins un est attendu. */
export const mapPointUpdateSchema = z
  .object({
    title: plainTextSchema(120, { allowLineBreaks: false }).refine((title) => title.length > 0, "obligatoire").optional(),
    description: plainTextSchema(2000, { allowLineBreaks: true }).optional(),
    category: z.enum(MAP_POINT_CATEGORIES).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine((update) => Object.values(update).some((value) => value !== undefined), "aucune modification envoyée")
  .refine((update) => (update.latitude === undefined) === (update.longitude === undefined), "latitude et longitude vont ensemble");

export const mapPointIdParametersSchema = z.object({ pointId: z.uuid("identifiant de point invalide") });

/**
 * Zone visible de la carte. west > east est permis : la zone traverse
 * l'antiméridien (180°), cas d'une carte très dézoomée sur le Pacifique.
 */
export const boundingBoxQuerySchema = z
  .object({
    south: latitudeSchema,
    west: longitudeSchema,
    north: latitudeSchema,
    east: longitudeSchema,
  })
  .refine((box) => box.south <= box.north, "south doit être inférieur ou égal à north");

export const MAXIMUM_PROXIMITY_RADIUS_METERS = 50_000;

export const proximityQuerySchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
  radius: z.coerce.number().positive("rayon positif").max(MAXIMUM_PROXIMITY_RADIUS_METERS, "rayon de 50 km maximum").default(5_000),
});

/** z/x/y d'une tuile : entiers, et x, y dans la grille du niveau z (0 à 2^z - 1). */
export function createTileCoordinatesSchema(maximumZoom) {
  const nonNegativeIntegerText = z.string().regex(/^\d{1,7}$/, "entier attendu").transform(Number);
  return z
    .object({ z: nonNegativeIntegerText, x: nonNegativeIntegerText, y: nonNegativeIntegerText })
    .refine((tile) => tile.z <= maximumZoom, `zoom ${maximumZoom} maximum`)
    .refine((tile) => tile.x < 2 ** tile.z && tile.y < 2 ** tile.z, "tuile hors de la grille");
}
