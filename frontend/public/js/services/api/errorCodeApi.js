/**
 * Menu « Codes d'erreur connus » : réponses enregistrées en base, lues par
 * le backend SANS IA (ni LLM, ni embedding).
 * ✅ API RÉELLE (relayée telle quelle par le proxy frontend) :
 *    GET /api/error_code?device_type=gab  -> [{ id, code, label }]
 *    GET /api/error_code/{id}/solution       -> { id, code, label, reply }
 *    reply : un paragraphe par ligne.
 */

import { FORCE_MOCKS } from "../../config.js";
import { ApiRequestError, getJson } from "../../core/httpClient.js";
import { mockErrorCodeReplyResponse, mockErrorCodesResponse } from "./mocks.js";

/**
 * @typedef {{ id: number, code: string, label: string }} KnownErrorCode
 */

/** @returns {Promise<KnownErrorCode[]>} */
export async function listKnownErrorCodes(deviceType) {
  const payload = FORCE_MOCKS
    ? await mockErrorCodesResponse({ deviceType })
    : await getJson(`/error_code?device_type=${encodeURIComponent(deviceType)}`);

  if (!Array.isArray(payload)) {
    throw new ApiRequestError("Liste des codes d'erreur invalide.", { kind: "invalid-response" });
  }
  return payload
    .filter((item) => Number.isInteger(item?.id) && typeof item?.code === "string")
    .map((item) => ({ id: item.id, code: item.code.trim(), label: (item.label || "").trim() }));
}

/** @returns {Promise<string>} la réponse enregistrée, un paragraphe par ligne */
export async function getErrorCodeReply(errorCodeId) {
  const payload = FORCE_MOCKS
    ? await mockErrorCodeReplyResponse({ errorCodeId })
    : await getJson(`/error_code/${encodeURIComponent(errorCodeId)}/solution`);

  if (typeof payload?.reply !== "string" || !payload.reply.trim()) {
    throw new ApiRequestError("Réponse du code d'erreur invalide.", { kind: "invalid-response" });
  }
  return payload.reply.trim();
}
