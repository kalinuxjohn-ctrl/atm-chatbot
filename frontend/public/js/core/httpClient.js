/**
 * SEUL endroit de l'application qui appelle fetch().
 * Les services API passent tous par postJson() / getJson() : gestion du
 * délai, des erreurs réseau et du JSON invalide écrite une seule fois.
 */

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "../config.js";

/**
 * Erreur typée : `kind` permet à l'interface de choisir un message adapté
 * sans analyser du texte.
 * kind : "timeout" | "network" | "server" | "request" | "invalid-json" | "invalid-response"
 */
export class ApiRequestError extends Error {
  constructor(message, { status = null, kind = "api", detail = null } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.kind = kind;
    // Message clair renvoyé par le backend ({ "detail": "..." }), quand il en donne un.
    this.detail = detail;
  }
}

export function postJson(path, body, options = {}) {
  return requestJson("POST", path, { ...options, body });
}

export function getJson(path, options = {}) {
  return requestJson("GET", path, options);
}

export function putJson(path, body, options = {}) {
  return requestJson("PUT", path, { ...options, body });
}

export function deleteJson(path, options = {}) {
  return requestJson("DELETE", path, options);
}

async function requestJson(method, path, { body, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    console.error(`Requête ${path} impossible.`, error);
    throw new ApiRequestError("La requête n’a pas pu aboutir.", { kind: isTimeout ? "timeout" : "network" });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    console.error(`Réponse ${path} : JSON invalide.`, error);
    throw new ApiRequestError("Réponse JSON invalide.", { status: response.status, kind: "invalid-json" });
  }

  if (!response.ok) {
    console.error(`Requête ${path} en échec (HTTP ${response.status}).`, payload);
    throw new ApiRequestError("La requête a échoué.", {
      status: response.status,
      kind: response.status >= 500 ? "server" : "request",
      detail: readErrorDetail(payload?.detail),
    });
  }

  return payload;
}

/**
 * Message du backend : texte simple, ou liste d'erreurs de validation
 * FastAPI (HTTP 422) dont on garde les messages lisibles.
 */
function readErrorDetail(detail) {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;
  const messages = detail
    .map((item) => (typeof item?.msg === "string" ? item.msg.replace(/^Value error, /, "") : null))
    .filter(Boolean);
  return messages.length ? messages.join(" ") : null;
}

// HTTP 503 du backend = une ressource indispensable est indisponible.
// La cause précise reste dans les journaux du serveur : le technicien n'a
// pas à savoir quels services travaillent derrière le chatbot.
const SATURATED_MESSAGE = "Désolé, le chatbot est actuellement saturé. Réessayez dans quelques instants.";

/** Message lisible par le technicien, quelle que soit l'erreur. */
export function getFriendlyErrorMessage(error) {
  if (!(error instanceof ApiRequestError)) {
    console.error("Erreur inattendue.", error);
  } else if (error.status === 503) {
    return error.detail || SATURATED_MESSAGE;
  } else if (error.status === 409 && error.detail) {
    return error.detail;
  } else if (error.kind === "timeout") {
    return "L’analyse prend plus de temps que prévu. Vérifiez votre connexion et réessayez.";
  } else if (error.kind === "network") {
    return "Impossible de joindre le service pour le moment. Vérifiez votre connexion et réessayez.";
  } else if (error.kind === "request") {
    return "La demande a été refusée. Vérifiez les informations saisies et réessayez.";
  }
  return "Impossible de traiter votre demande pour le moment. Veuillez réessayer dans quelques instants.";
}
