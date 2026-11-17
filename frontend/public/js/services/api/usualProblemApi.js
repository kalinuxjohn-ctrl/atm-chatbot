/**
 * Menu « Pannes fréquentes » : réponses enregistrées en base, lues par le
 * backend SANS IA (ni LLM, ni embedding).
 * ✅ API RÉELLE (relayée telle quelle par le proxy frontend) :
 *    GET /api/usual_problem?device_type=gab  -> [{ id, label }]
 *    GET /api/usual_problem/{id}/solution       -> { id, label, reply }
 *    reply : un paragraphe par ligne.
 */

import { FORCE_MOCKS } from "../../config.js";
import { ApiRequestError, getJson } from "../../core/httpClient.js";
import { mockUsualProblemReplyResponse, mockUsualProblemsResponse } from "./mocks.js";

/**
 * @typedef {{ id: number, label: string }} UsualProblem
 */

/** @returns {Promise<UsualProblem[]>} */
export async function listUsualProblems(deviceType) {
  const payload = FORCE_MOCKS
    ? await mockUsualProblemsResponse({ deviceType })
    : await getJson(`/usual_problem?device_type=${encodeURIComponent(deviceType)}`);

  if (!Array.isArray(payload)) {
    throw new ApiRequestError("Liste des pannes fréquentes invalide.", { kind: "invalid-response" });
  }
  return payload
    .filter((item) => Number.isInteger(item?.id) && typeof item?.label === "string" && item.label.trim())
    .map((item) => ({ id: item.id, label: item.label.trim() }));
}

/** @returns {Promise<string>} la réponse enregistrée, un paragraphe par ligne */
export async function getUsualProblemReply(usualProblemId) {
  const payload = FORCE_MOCKS
    ? await mockUsualProblemReplyResponse({ usualProblemId })
    : await getJson(`/usual_problem/${encodeURIComponent(usualProblemId)}/solution`);

  if (typeof payload?.reply !== "string" || !payload.reply.trim()) {
    throw new ApiRequestError("Réponse de la panne fréquente invalide.", { kind: "invalid-response" });
  }
  return payload.reply.trim();
}
