/**
 * Validation des entrées avec zod : un seul point de passage, pour que
 * toutes les fonctionnalités renvoient la même erreur 422 au même format.
 */

import { InvalidReferenceError } from "./errors.js";

/**
 * Valide `untrustedData` (corps, paramètres d'URL, query string) avec `schema`
 * et renvoie la donnée nettoyée. Lève InvalidReferenceError sinon.
 */
export function parseWithSchema(schema, untrustedData) {
  const parsedData = schema.safeParse(untrustedData);
  if (parsedData.success) {
    return parsedData.data;
  }
  // Chemin + message de chaque problème ; jamais la valeur reçue (elle peut être un mot de passe).
  const validationIssues = parsedData.error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
  const firstIssue = validationIssues[0];
  const summary = firstIssue.field ? `${firstIssue.field} : ${firstIssue.message}` : firstIssue.message;
  throw new InvalidReferenceError(summary, validationIssues);
}
