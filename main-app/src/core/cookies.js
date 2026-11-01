/**
 * Lecture de l'en-tête Cookie, sans dépendance supplémentaire : on n'a
 * besoin que d'un seul cookie (la session), lu par Express ET par le
 * WebSocket des appels (qui ne passe pas par Express).
 */

export function readCookieValue(cookieHeader, cookieName) {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) {
    return null;
  }
  for (const cookiePair of cookieHeader.split(";")) {
    const separatorIndex = cookiePair.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    if (cookiePair.slice(0, separatorIndex).trim() === cookieName) {
      const rawValue = cookiePair.slice(separatorIndex + 1).trim();
      try {
        return decodeURIComponent(rawValue);
      } catch {
        // Valeur mal encodée : traitée comme absente plutôt que de faire échouer la requête.
        return null;
      }
    }
  }
  return null;
}
