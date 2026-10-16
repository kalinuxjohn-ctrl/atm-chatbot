/**
 * API de conversation texte.
 * ✅ API RÉELLE : POST /api/chat  (relayée telle quelle par le proxy frontend)
 *    Corps   : { technician_id, message, conversation_id?, device_type? }
 *    Réponse : { conversation_id, reply, solution_proposal_available,
 *                intervention_add_available, intervention_add_problem }
 *    solution_proposal_available = ce message a produit des solutions : le
 *    chat propose alors « Aucune de ces solutions ne fonctionne ».
 */

import { FORCE_MOCKS } from "../../config.js";
import { ApiRequestError, postJson } from "../../core/httpClient.js";
import { mockChatResponse } from "./mocks.js";

/**
 * @returns {Promise<{conversationId: number, reply: string, solutionProposalAvailable: boolean,
 *   interventionAddAvailable: boolean, interventionAddProblem: string|null}>}
 */
export async function sendMessage({ message, technicianId, conversationId = null, deviceType = null }) {
  const payload = FORCE_MOCKS
    ? await mockChatResponse({ conversationId, message })
    : await postJson("/chat", {
        technician_id: technicianId,
        message,
        conversation_id: conversationId,
        device_type: deviceType, // "gab" | "tpe" | null : seules valeurs acceptées par le backend
      });

  if (!Number.isInteger(payload?.conversation_id) || typeof payload?.reply !== "string") {
    throw new ApiRequestError("Réponse de conversation invalide.", { kind: "invalid-response" });
  }
  return {
    conversationId: payload.conversation_id,
    reply: payload.reply.trim(),
    solutionProposalAvailable: payload.solution_proposal_available === true,
    interventionAddAvailable: payload.intervention_add_available === true,
    interventionAddProblem: payload.intervention_add_problem ?? null,
  };
}
