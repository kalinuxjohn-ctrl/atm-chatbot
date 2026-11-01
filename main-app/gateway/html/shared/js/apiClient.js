/**
 * Appels à l'API de la main app, communs à toutes les pages.
 *
 * Toujours la même origine (cookie de session envoyé automatiquement, aucune
 * clé ni token dans le JavaScript). Les erreurs du backend ont toutes la
 * forme { error: { code, message } } : on les transforme en ApiRequestError.
 */

export class ApiRequestError extends Error {
  constructor(httpStatus, errorCode, message) {
    super(message);
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
  }
}

/**
 * `body` : objet envoyé en JSON, ou FormData (pièce jointe) envoyé tel quel.
 * Renvoie le JSON de la réponse, ou null pour une réponse sans contenu (204).
 */
export async function requestJson(path, { method = "GET", body = undefined, signal = undefined } = {}) {
  const requestOptions = { method, credentials: "same-origin", headers: { Accept: "application/json" }, signal };
  if (body instanceof FormData) {
    requestOptions.body = body;
  } else if (body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, requestOptions);
  } catch (networkError) {
    if (networkError.name === "AbortError") {
      throw networkError;
    }
    throw new ApiRequestError(0, "network_error", "Connexion au serveur impossible. Vérifiez votre réseau.");
  }

  if (response.status === 204) {
    return null;
  }
  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      responseBody?.error?.code ?? "unknown_error",
      responseBody?.error?.message ?? describeHttpStatus(response.status),
    );
  }
  return responseBody;
}

function describeHttpStatus(httpStatus) {
  if (httpStatus === 429) {
    return "Trop de requêtes. Patientez un instant.";
  }
  if (httpStatus === 503) {
    return "Service momentanément indisponible.";
  }
  return "Erreur inattendue. Réessayez.";
}

/** Session absente ou expirée : retour à la page de connexion, puis retour ici après connexion. */
export function redirectToLoginPage() {
  const currentPath = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/auth/login.html?next=${encodeURIComponent(currentPath)}`);
}
