/**
 * Construit l'app Express d'UNE fonctionnalité (auth, map, messaging, calls).
 * Chaque fichier de src/entrypoints/ l'appelle avec ses routes : tous les
 * conteneurs ont ainsi exactement le même socle (limites, /health, pages,
 * gestion des erreurs).
 *
 *   /health               état du conteneur et de la base (healthcheck Docker)
 *   /api/<feature>/...    routes JSON de la fonctionnalité
 *   /<feature>/...        pages de web/<feature>/ (HTML, CSS, JS natif)
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { errorHandler } from "../middlewares/errorHandler.js";
import { checkDatabaseConnection } from "./database.js";
import { ReferenceNotFoundError } from "./errors.js";

const mainAppRootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function createFeatureApp({ featureName, configuration, apiRouter, additionalStaticDirectories = [] }) {
  const featureApp = express();
  featureApp.locals.configuration = configuration;

  // Ne pas annoncer la techno du serveur.
  featureApp.disable("x-powered-by");
  // Seul le gateway nginx parle à ce conteneur (aucun port publié) : on peut
  // croire l'adresse client qu'il transmet, et seulement depuis un réseau privé.
  featureApp.set("trust proxy", "loopback, uniquelocal");

  // Limite basse : les seuls gros corps (pièces jointes) passent par multer, pas par ici.
  featureApp.use(express.json({ limit: "32kb" }));

  featureApp.get("/health", async (request, response) => {
    try {
      await checkDatabaseConnection();
      response.json({ status: "ok", feature: featureName });
    } catch {
      response.status(503).json({ status: "database_unavailable", feature: featureName });
    }
  });

  featureApp.use(`/api/${featureName}`, apiRouter);
  // Route d'API inconnue : JSON 404 (et non la page HTML par défaut d'Express).
  featureApp.use(`/api/${featureName}`, (request, response, next) => next(new ReferenceNotFoundError("Route inconnue.")));

  // maxAge 0 : le navigateur revalide chaque fichier (ETag -> 304, sans retransfert).
  // Avec un cache d'une heure, une mise à jour du JavaScript n'arrivait chez
  // l'utilisateur qu'une heure plus tard, mélangée à d'anciens fichiers.
  const staticFileOptions = { dotfiles: "deny", index: "index.html", fallthrough: true, maxAge: 0 };
  featureApp.use(`/${featureName}`, express.static(path.join(mainAppRootDirectory, "web", featureName), staticFileOptions));
  for (const { urlPath, directory } of additionalStaticDirectories) {
    featureApp.use(urlPath, express.static(path.join(mainAppRootDirectory, directory), staticFileOptions));
  }

  featureApp.use((request, response, next) => next(new ReferenceNotFoundError("Page introuvable.")));
  featureApp.use(errorHandler);
  return featureApp;
}
