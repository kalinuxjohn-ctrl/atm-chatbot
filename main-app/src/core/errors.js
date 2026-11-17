/**
 * Erreurs métier typées, les mêmes que celles du chatbot (app/core/errors.py).
 *
 * Les services lèvent ces erreurs sans rien savoir de HTTP ; seul
 * middlewares/errorHandler.js les traduit en statut + { error: { code, message } }.
 * Le message est destiné à l'utilisateur : il ne doit jamais contenir de
 * détail technique (requête SQL, chemin de fichier, pile d'appels).
 */

export class ApplicationError extends Error {
  constructor(message, { httpStatus, errorCode }) {
    super(message);
    this.name = new.target.name;
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
  }
}

/** La ressource demandée n'existe pas, ou l'utilisateur n'a pas à savoir qu'elle existe (404). */
export class ReferenceNotFoundError extends ApplicationError {
  constructor(message = "Ressource introuvable.") {
    super(message, { httpStatus: 404, errorCode: "reference_not_found" });
  }
}

/** Donnée envoyée invalide : format, longueur, valeur hors limites (422). */
export class InvalidReferenceError extends ApplicationError {
  constructor(message = "Donnée invalide.", validationIssues = []) {
    super(message, { httpStatus: 422, errorCode: "invalid_reference" });
    // Détail champ par champ, sans les valeurs saisies (elles peuvent être sensibles).
    this.validationIssues = validationIssues;
  }
}

/** Utilisateur connu, mais sans le droit de faire cette action (403). */
export class AccessDeniedError extends ApplicationError {
  constructor(message = "Action non autorisée.") {
    super(message, { httpStatus: 403, errorCode: "access_denied" });
  }
}

/** L'action est impossible dans l'état actuel (déjà existant, déjà en appel...) (409). */
export class StateConflictError extends ApplicationError {
  constructor(message = "Action impossible dans l'état actuel.") {
    super(message, { httpStatus: 409, errorCode: "state_conflict" });
  }
}

/** Un service extérieur (fournisseur de tuiles, base de données) ne répond pas (503). */
export class ExternalServiceUnavailableError extends ApplicationError {
  constructor(message = "Service momentanément indisponible.") {
    super(message, { httpStatus: 503, errorCode: "external_service_unavailable" });
  }
}

// --- Erreurs propres à une web app avec connexion (absentes du chatbot, qui n'a pas de comptes) ---

/** Aucune session valide : l'utilisateur doit se connecter (401). */
export class AuthenticationRequiredError extends ApplicationError {
  constructor(message = "Connexion requise.") {
    super(message, { httpStatus: 401, errorCode: "authentication_required" });
  }
}

/** Trop d'essais en peu de temps (connexion) : verrouillage temporaire (429). */
export class TooManyAttemptsError extends ApplicationError {
  constructor(message = "Trop de tentatives. Réessayez dans quelques minutes.") {
    super(message, { httpStatus: 429, errorCode: "too_many_attempts" });
  }
}

/** Fichier ou corps de requête trop volumineux (413). */
export class PayloadTooLargeError extends ApplicationError {
  constructor(message = "Fichier trop volumineux.") {
    super(message, { httpStatus: 413, errorCode: "payload_too_large" });
  }
}
