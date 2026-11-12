/**
 * API de conversation texte.
 * ✅ API RÉELLE : POST /api/chat ; /api/chat/stream si onDelta est fourni.
 *    Corps   : { technician_id, message, conversation_id?, device_type?, photo? }
 *    photo   : { media_type, data_base64 } (composerPhoto.js) ; message peut
 *              alors être vide. Le backend n'en lit que le texte affiché.
 *    Réponse : { conversation_id, reply, solution_proposal_available,
 *                intervention_add_available, intervention_add_problem }
 *    solution_proposal_available = ce message a produit des solutions : le
 *    chat propose alors « Aucune de ces solutions ne fonctionne ».
 */

import { FORCE_MOCKS } from "../../config.js";
import { ApiRequestError, postJson, postJsonStream } from "../../core/httpClient.js";
import { mockChatResponse, mockErrorCodeSelectionResponse } from "./mocks.js";

/**
 * @returns {Promise<{conversationId: number, reply: string, solutionProposalAvailable: boolean,
 *   interventionAddAvailable: boolean, interventionAddProblem: string|null}>}
 */
export async function sendMessage({ message, technicianId, conversationId = null, deviceType = null, photo = null, onDelta = null }) {
  const body = {
    technician_id: technicianId, message, conversation_id: conversationId,
    device_type: deviceType, ...(photo ? { photo } : {}),
  };
  if (!FORCE_MOCKS && onDelta) {
    let result = null;
    await postJsonStream("/chat/stream", body, (event) => {
      if (event?.type === "ping") return;
      if (result !== null) {
        throw new ApiRequestError("Événement reçu après la fin de la réponse.", { kind: "invalid-response" });
      }
      if (event?.type === "delta" && typeof event.text === "string") {
        onDelta(event.text);
      } else if (event?.type === "done") {
        result = readChatResponse(event.response);
      } else if (event?.type === "error" && Number.isInteger(event.status)
        && event.status >= 400 && event.status <= 599 && typeof event.detail === "string") {
        throw new ApiRequestError("La réponse a été interrompue.", {
          status: event.status, kind: event.status >= 500 ? "server" : "request", detail: event.detail,
        });
      } else {
        throw new ApiRequestError("Événement de réponse invalide.", { kind: "invalid-response" });
      }
    });
    if (!result) {
      console.error("Flux de conversation terminé sans réponse complète.");
      throw new ApiRequestError("La réponse est incomplète.", { kind: "invalid-response" });
    }
    return result;
  }
  const payload = FORCE_MOCKS
    ? await mockChatResponse({ conversationId, message })
    : await postJson("/chat", body);

  const result = readChatResponse(payload);
  if (onDelta) onDelta(result.reply);
  return result;
}

export async function selectErrorCode({ errorCodeId, technicianId, conversationId, deviceType }) {
  const payload = FORCE_MOCKS
    ? await mockErrorCodeSelectionResponse({ errorCodeId, conversationId, deviceType })
    : await postJson("/chat/error-code", {
        error_code_id: errorCodeId, technician_id: technicianId,
        conversation_id: conversationId, device_type: deviceType,
      });
  return readChatResponse(payload);
}

function readChatResponse(payload) {
  if (!Number.isInteger(payload?.conversation_id) || typeof payload?.reply !== "string") {
    throw new ApiRequestError("Réponse de conversation invalide.", { kind: "invalid-response" });
  }
  return {
    conversationId: payload.conversation_id,
    reply: payload.reply.trim(),
    detectedErrorCode: payload.detected_error_code ?? null,
    errorCodeId: payload.error_code_id ?? null,
    solutionProposalAvailable: payload.solution_proposal_available === true,
    interventionAddAvailable: payload.intervention_add_available === true,
    interventionAddProblem: payload.intervention_add_problem ?? null,
  };
}
