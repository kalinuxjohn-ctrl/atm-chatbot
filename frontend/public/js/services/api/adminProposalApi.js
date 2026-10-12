/**
 * API d'administration des propositions de solution.
 * ✅ API RÉELLE, protégée par la clé ADMIN_API_KEY (en-tête X-Admin-Key) :
 *   GET  /api/admin/solution-proposals?status=pending|approved|rejected
 *   POST /api/admin/solution-proposals/{id}/approve  { reviewed_by, admin_comment?, canonical_text? }
 *   POST /api/admin/solution-proposals/{id}/reject   { reviewed_by, admin_comment }
 *
 * Les propositions sont renvoyées telles que le backend les décrit (snake_case) :
 * la page d'administration ne fait que les afficher.
 */

import { FORCE_MOCKS } from "../../config.js";
import { ApiRequestError, getJson, postJson } from "../../core/httpClient.js";
import { mockListProposalsResponse, mockReviewProposalResponse } from "./mocks.js";

const adminHeaders = (adminKey) => ({ "X-Admin-Key": adminKey });

export async function listProposals({ adminKey, status = "pending" }) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const payload = FORCE_MOCKS
    ? await mockListProposalsResponse({ status })
    : await getJson(`/admin/solution-proposals${query}`, { headers: adminHeaders(adminKey) });
  if (!Array.isArray(payload)) throw new ApiRequestError("Liste de propositions invalide.", { kind: "invalid-response" });
  return payload;
}

/**
 * @param {"approve"|"reject"} decision
 * @returns {Promise<{ proposal: object, knowledgeIntegration: string|null, attachedInterventionId: number|null }>}
 */
export async function reviewProposal({ adminKey, proposalId, decision, reviewedBy, adminComment, canonicalText }) {
  const body = { reviewed_by: reviewedBy, admin_comment: adminComment || null };
  if (decision === "approve" && canonicalText) body.canonical_text = canonicalText;

  const payload = FORCE_MOCKS
    ? await mockReviewProposalResponse({ proposalId, decision, reviewedBy, adminComment })
    : await postJson(`/admin/solution-proposals/${encodeURIComponent(proposalId)}/${decision}`, body, {
        headers: adminHeaders(adminKey),
      });
  if (!payload?.proposal) throw new ApiRequestError("Réponse de validation invalide.", { kind: "invalid-response" });
  return {
    proposal: payload.proposal,
    knowledgeIntegration: payload.knowledge_integration ?? null,
    // Intervention dont le problème porte désormais cette solution (null : pas de cas de référence).
    attachedInterventionId: payload.attached_intervention_id ?? null,
  };
}
