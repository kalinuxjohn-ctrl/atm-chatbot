/**
 * API de recherche de symptôme (page Diagnostic).
 * ✅ API RÉELLE : POST /chat/search-symptom  (via le proxy : /api/chat/search-symptom)
 *    Corps   : { raw_text, device_type: "gab" | "tpe" }
 *    Réponse : { matched_symptom_ids, solutions[], summary }
 */

import { ApiRequestError, postJson } from "../../core/httpClient.js";

// Quand le LLM (Ollama) est indisponible, le backend renvoie son erreur dans
// `summary` : on la détecte pour ne pas l'afficher comme un vrai résumé.
const OLLAMA_ERROR_MARKERS = [
  "ollama",
  "impossible de joindre",
  "n'a pas répondu dans le délai",
  "n'est pas installé",
  "a répondu avec une erreur",
];

/** Convertit la réponse snake_case de l'API en objet sûr pour l'interface. */
function transformSearchResponse(payload) {
  if (
    !payload ||
    !Array.isArray(payload.solutions) ||
    !Array.isArray(payload.matched_symptom_ids) ||
    typeof payload.summary !== "string"
  ) {
    throw new ApiRequestError("Réponse API invalide.", { kind: "invalid-response" });
  }

  const summaryHasProviderError = OLLAMA_ERROR_MARKERS.some((marker) =>
    payload.summary.toLocaleLowerCase("fr").includes(marker),
  );

  return {
    matchedSymptomIds: payload.matched_symptom_ids.filter((symptomId) => Number.isInteger(symptomId)),
    summary: summaryHasProviderError ? "" : payload.summary.trim(),
    summaryUnavailable: summaryHasProviderError,
    solutions: payload.solutions.map((solution) => ({
      actionId: Number.isInteger(solution?.action_id) ? solution.action_id : null,
      actionText: typeof solution?.action_text === "string" ? solution.action_text.trim() : "",
      symptomId: Number.isInteger(solution?.symptom_id) ? solution.symptom_id : null,
      symptomText: typeof solution?.symptom_text === "string" ? solution.symptom_text.trim() : "",
      attempts: Number.isFinite(solution?.attempts) ? solution.attempts : null,
      successes: Number.isFinite(solution?.successes) ? solution.successes : null,
      accuracy: Number.isFinite(solution?.accuracy_score) ? solution.accuracy_score : null,
    })),
  };
}

export async function searchSymptoms(rawText, deviceType) {
  const payload = await postJson("/chat/search-symptom", { raw_text: rawText, device_type: deviceType });
  return transformSearchResponse(payload);
}
