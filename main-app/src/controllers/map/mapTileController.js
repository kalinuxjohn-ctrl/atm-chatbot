/**
 * Tuiles du fond de carte (relais vers le fournisseur, voir tileProxyService.js)
 * et réglages affichés par la page (attribution obligatoire, zoom maximal).
 */

import { parseWithSchema } from "../../core/validation.js";
import { createTileCoordinatesSchema } from "../../schemas/map/mapSchemas.js";

export async function serveTile(request, response) {
  const { MAIN_APP_MAP_TILE_MAX_ZOOM } = request.app.locals.configuration;
  const tileCoordinates = parseWithSchema(createTileCoordinatesSchema(MAIN_APP_MAP_TILE_MAX_ZOOM), request.params);
  const { mediaType, tileBytes } = await request.app.locals.tileProxy.findTile(tileCoordinates);
  response.set({
    "Content-Type": mediaType,
    // private : la tuile passe par une route authentifiée, aucun cache partagé ne doit la garder.
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  response.send(tileBytes);
}

export function readMapSettings(request, response) {
  const { MAIN_APP_MAP_TILE_ATTRIBUTION, MAIN_APP_MAP_TILE_MAX_ZOOM } = request.app.locals.configuration;
  response.json({ attribution: MAIN_APP_MAP_TILE_ATTRIBUTION, maximumZoom: MAIN_APP_MAP_TILE_MAX_ZOOM });
}
