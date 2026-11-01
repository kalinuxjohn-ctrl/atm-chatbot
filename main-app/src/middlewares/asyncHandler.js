/**
 * Enveloppe un controller async : une erreur levée (ou une promesse rejetée)
 * part vers errorHandler au lieu d'être perdue. Express 5 le fait déjà, mais
 * l'enveloppe rend la règle visible et identique dans toutes les routes.
 */
export function asyncHandler(controller) {
  return function runControllerAndForwardErrors(request, response, next) {
    Promise.resolve(controller(request, response, next)).catch(next);
  };
}
