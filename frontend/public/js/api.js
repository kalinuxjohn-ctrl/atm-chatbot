const API_BASE_URL = "/api";

const OLLAMA_ERROR_MARKERS = [
  "ollama",
  "impossible de joindre",
  "n'a pas répondu dans le délai",
  "n'est pas installé",
  "a répondu avec une erreur",
];

export class ApiRequestError extends Error {
  constructor(message, { status = null, kind = "api" } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.kind = kind;
  }
}

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
    matchedSymptomIds: payload.matched_symptom_ids.filter(
      (symptomId) => typeof symptomId === "number" && Number.isInteger(symptomId),
    ),
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

async function readResponseBody(response) {
  try {
    return await response.json();
  } catch (error) {
    console.error("La réponse de l'API n'est pas un JSON valide.", error);
    throw new ApiRequestError("Réponse JSON invalide.", {
      status: response.status,
      kind: "invalid-json",
    });
  }
}

export async function searchSymptoms(rawText, deviceType) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/chat/search-symptom`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ raw_text: rawText, device_type: deviceType }),
      signal: AbortSignal.timeout(65000),
    });
  } catch (error) {
    console.error("Échec de la requête de recherche du symptôme.", error);
    throw new ApiRequestError("La requête n’a pas pu aboutir.", {
      kind: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network",
    });
  }

  let payload;
  try {
    payload = await readResponseBody(response);
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    console.error("Impossible de lire la réponse de l'API.", error);
    throw new ApiRequestError("Réponse API invalide.", {
      status: response.status,
      kind: "invalid-json",
    });
  }

  if (!response.ok) {
    console.error(`La recherche a échoué (HTTP ${response.status}).`, payload);
    throw new ApiRequestError("La recherche a échoué.", {
      status: response.status,
      kind: response.status >= 500 ? "server" : "request",
    });
  }

  return transformSearchResponse(payload);
}
