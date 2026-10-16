import { FORCE_MOCKS } from "../../config.js";
import { ApiRequestError, postJson } from "../../core/httpClient.js";
import { mockInterventionAddResponse } from "./mocks.js";

export async function submitInterventionAdd(content) {
  const payload = FORCE_MOCKS
    ? await mockInterventionAddResponse(content)
    : await postJson("/intervention_add", content);
  if (!Number.isInteger(payload?.intervention_add_id) || payload.status !== "pending") {
    throw new ApiRequestError("Réponse d'ajout d'intervention invalide.", { kind: "invalid-response" });
  }
  return { id: payload.intervention_add_id, status: payload.status };
}
