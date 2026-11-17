/**
 * Dernier middleware : traduit toute erreur en réponse JSON
 * { error: { code, message } }.
 *
 * - Erreur métier typée (core/errors.js) : son statut et son message.
 * - Toute autre erreur = bug ou panne : 500 avec un message générique.
 *   La cause précise va dans les traces, jamais dans la réponse (pas de pile
 *   d'appels ni de requête SQL exposée, même hors production).
 */

import { ApplicationError } from "../core/errors.js";
import { trace } from "../core/tracing.js";

export function errorHandler(error, request, response, next) {
  if (response.headersSent) {
    // Réponse déjà commencée (fichier en cours d'envoi) : Express doit couper la connexion.
    next(error);
    return;
  }

  if (error instanceof ApplicationError) {
    const errorBody = { code: error.errorCode, message: error.message };
    if (error.validationIssues?.length) {
      errorBody.issues = error.validationIssues;
    }
    response.status(error.httpStatus).json({ error: errorBody });
    return;
  }

  // Corps JSON illisible ou trop gros (express.json) : faute du client, pas du serveur.
  if (error.type === "entity.parse.failed") {
    response.status(400).json({ error: { code: "invalid_json", message: "Corps de requête JSON invalide." } });
    return;
  }
  if (error.type === "entity.too.large") {
    response.status(413).json({ error: { code: "payload_too_large", message: "Requête trop volumineuse." } });
    return;
  }

  trace("ERROR", "Erreur interne non prévue", {
    method: request.method,
    path: request.path,
    errorName: error.name,
    errorMessage: error.message,
  });
  response.status(500).json({ error: { code: "internal_error", message: "Erreur interne. Réessayez plus tard." } });
}
