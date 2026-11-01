/**
 * Conteneur main-app-map : points de la carte + relais des tuiles.
 * Pages : web/map/. Librairies de carte servies EN LOCAL depuis node_modules
 * (aucun CDN : la CSP n'autorise que 'self').
 */

import { loadConfiguration } from "../core/config.js";
import { createFeatureApp } from "../core/createFeatureApp.js";
import { startFeatureServer } from "../core/startFeatureServer.js";
import { createMapRouter } from "../routes/map/mapRoutes.js";
import { createTileProxy } from "../services/map/tileProxyService.js";

const configuration = loadConfiguration("map");
const featureApp = createFeatureApp({
  featureName: "map",
  configuration,
  apiRouter: createMapRouter(),
  additionalStaticDirectories: [
    { urlPath: "/map/vendor/leaflet", directory: "node_modules/leaflet/dist" },
    { urlPath: "/map/vendor/maplibre-gl", directory: "node_modules/maplibre-gl/dist" },
    { urlPath: "/map/vendor/maplibre-gl-leaflet", directory: "node_modules/@maplibre/maplibre-gl-leaflet" },
  ],
});
featureApp.locals.tileProxy = createTileProxy({
  urlTemplate: configuration.MAIN_APP_MAP_TILE_URL_TEMPLATE,
  userAgent: configuration.MAIN_APP_MAP_TILE_USER_AGENT,
  maximumEntries: configuration.MAIN_APP_MAP_TILE_CACHE_ENTRIES,
});

startFeatureServer({ featureApp, configuration });
