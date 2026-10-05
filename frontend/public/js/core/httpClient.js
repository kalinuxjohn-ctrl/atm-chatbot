/**
 * SEUL endroit de l'application qui appelle fetch().
 * Les services API passent tous par postJson() : gestion du délai, des
 * erreurs réseau et du JSON invalide écrite une seule fois.
 */

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "../config.js";

/**
 * Erreur typée : `kind` permet à l'interface de choisir un message adapté
 * sans analyser du texte.
 * kind : "timeout" | "network" | "server" | "request" | "invalid-json" | "invalid-response"
 */
export class ApiRequestError extends Error {
  constructor(message, { status = null, kind = "api" } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.kind = kind;
  }
}

export async function postJson(path, body, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
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
    });
  }

  return payload;
}

/**
 * Lit un fichier JSON STATIQUE servi par le frontend lui-même (ex.
 * /data/error-codes/E42.json) -- pas de préfixe /api, le backend n'est
 * jamais contacté. Les messages d'erreur sont faits pour la console du
 * développeur qui édite ces fichiers.
 */
export async function getStaticJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`fichier introuvable (HTTP ${response.status})`);
  try {
    return await response.json();
  } catch {
    throw new Error("JSON mal formé (virgule en trop, guillemet manquant… ?)");
  }
}

// HTTP 503 du backend = une IA externe n'a pas répondu (surcharge, quota…).
// La cause précise reste dans les journaux du serveur : le technicien n'a
// pas à savoir quels services travaillent derrière le chatbot.
const SATURATED_MESSAGE = "Désolé, le chatbot est actuellement saturé. Réessayez dans quelques instants.";

/** Message lisible par le technicien, quelle que soit l'erreur. */
export function getFriendlyErrorMessage(error) {
  if (!(error instanceof ApiRequestError)) {
    console.error("Erreur inattendue.", error);
  } else if (error.status === 503) {
    return SATURATED_MESSAGE;
  } else if (error.kind === "timeout") {
    return "L’analyse prend plus de temps que prévu. Vérifiez votre connexion et réessayez.";
  } else if (error.kind === "network") {
    return "Impossible de joindre le service pour le moment. Vérifiez votre connexion et réessayez.";
  } else if (error.kind === "request") {
    return "La demande a été refusée. Vérifiez les informations saisies et réessayez.";
  }
  return "Impossible de traiter votre demande pour le moment. Veuillez réessayer dans quelques instants.";
}
