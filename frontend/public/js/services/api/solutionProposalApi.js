/**
 * API des propositions de solution (côté technicien).
 * ✅ API RÉELLE :
 *   GET  /api/chat/conversations/{id}/solution-proposal-context?technician_id=
 *        -> problème actif, relu par le backend dans le contexte de la conversation
 *   POST /api/chat/conversations/{id}/solution-proposals
 *        Corps : { technician_id, proposed_action, result_description, outcome_status }
 *
 * Le frontend n'envoie JAMAIS d'identifiant métier (intervention, symptôme,
 * composant…) : le backend les retrouve lui-même. Le contexte reçu sert
 * uniquement à l'affichage.
 */

import { FORCE_MOCKS } from "../../config.js";
import { ApiRequestError, getJson, postJson } from "../../core/httpClient.js";
import { mockProposalContextResponse, mockSubmitProposalResponse } from "./mocks.js";

/**
 * @returns {Promise<{
 *   problem: { label: string, description: string, componentName: string|null, deviceLabel: string, errorCode: string|null },
 *   interventionId: number|null,
 *   referencePosition: number|null,
 *   previousResults: Array<{ position: number, interventionId: number|null, symptomText: string|null, solutionText: string|null }>,
 * }>}
 */
export async function getProposalContext({ conversationId, technicianId }) {
  const payload = FORCE_MOCKS
    ? await mockProposalContextResponse({ conversationId })
    : await getJson(
        `/chat/conversations/${encodeURIComponent(conversationId)}/solution-proposal-context?technician_id=${encodeURIComponent(technicianId)}`,
      );

  if (typeof payload?.problem?.label !== "string" || !Array.isArray(payload?.previous_results)) {
    throw new ApiRequestError("Contexte de proposition invalide.", { kind: "invalid-response" });
  }
  return {
    problem: {
      label: payload.problem.label,
      description: payload.problem.description,
      componentName: payload.problem.component_name ?? null,
      deviceLabel: payload.problem.device_label,
      errorCode: payload.problem.error_code ?? null,
    },
    interventionId: payload.context?.intervention_id ?? null,
    referencePosition: payload.reference_position ?? null,
    previousResults: payload.previous_results.map((result) => ({
      position: result.position,
      interventionId: result.intervention_id ?? null,
      symptomText: result.symptom_text ?? null,
      solutionText: result.solution_text ?? null,
    })),
  };
}

/**
 * @param {{ outcomeStatus: "resolved"|"partial" }} proposal
 * @returns {Promise<{ proposalId: number, reply: string }>}
 */
export async function submitProposal({ conversationId, technicianId, proposedAction, resultDescription, outcomeStatus }) {
  const payload = FORCE_MOCKS
    ? await mockSubmitProposalResponse({ conversationId, technicianId, proposedAction, resultDescription, outcomeStatus })
    : await postJson(`/chat/conversations/${encodeURIComponent(conversationId)}/solution-proposals`, {
        technician_id: technicianId,
        proposed_action: proposedAction,
        result_description: resultDescription,
        outcome_status: outcomeStatus,
      });

  if (!Number.isInteger(payload?.proposal_id) || typeof payload?.reply !== "string") {
    throw new ApiRequestError("Réponse de proposition invalide.", { kind: "invalid-response" });
  }
  return { proposalId: payload.proposal_id, reply: payload.reply };
}
