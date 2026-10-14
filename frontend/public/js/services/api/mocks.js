/**
 * Réponses SIMULÉES, regroupées ici pour être faciles à retrouver puis à
 * supprimer. Chaque mock respecte le format de l'API réelle (ou future) :
 * l'interface ne voit aucune différence.
 */

const MOCK_REPLIES = [
  "Je vous recommande de vérifier le lecteur de carte.",
  "Commencez par contrôler le mécanisme de rétention de carte, puis relancez une transaction de test.",
  "Si le problème persiste, réinitialisez le lecteur de carte et notez le résultat dans l’intervention.",
];

let nextMockConversationId = 1;
let mockReplyIndex = 0;

function simulateLatency(minMs = 600, maxMs = 1200) {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Même format que POST /chat : { conversation_id, reply }. */
export async function mockChatResponse({ conversationId }) {
  await simulateLatency();
  const reply = MOCK_REPLIES[mockReplyIndex % MOCK_REPLIES.length];
  mockReplyIndex += 1;
  // Les deux premières réponses simulent des solutions trouvées.
  return {
    conversation_id: conversationId ?? nextMockConversationId++,
    reply,
    solution_proposal_available: mockReplyIndex <= 2,
  };
}

/** Format prévu pour une future API vocale : { text, audio }. */
export async function mockVoiceResponse({ conversationId }) {
  const chat = await mockChatResponse({ conversationId });
  return { conversation_id: chat.conversation_id, text: chat.reply, audio: null };
}

/** Format prévu pour une future API d'authentification. */
export async function mockLoginResponse({ technicianId, displayName }) {
  await simulateLatency(300, 600);
  return { technician_id: technicianId, display_name: displayName };
}

/* ---------- Menus de suggestions (codes d'erreur, pannes fréquentes) ---------- */

const MOCK_ERROR_CODES = [{ id: 1, code: "E42", label: "Capteur de rétention de carte ne répond pas", deviceType: "gab" }];
const MOCK_USUAL_PROBLEMS = [
  { id: 1, label: "Le GAB a avalé la carte du client", deviceType: "gab" },
  { id: 6, label: "Le TPE ne lit pas la carte", deviceType: "tpe" },
];
const MOCK_SAVED_REPLY = "Réponse enregistrée (mode démo).\n1. Première vérification.\n2. Deuxième vérification.";

/** Même format que GET /error_code?device_type=... */
export async function mockErrorCodesResponse({ deviceType }) {
  await simulateLatency(100, 300);
  return MOCK_ERROR_CODES.filter((item) => item.deviceType === deviceType).map(({ id, code, label }) => ({ id, code, label }));
}

/** Même format que GET /error_code/{id}/solution. */
export async function mockErrorCodeReplyResponse({ errorCodeId }) {
  await simulateLatency(100, 300);
  return { id: errorCodeId, reply: MOCK_SAVED_REPLY };
}

/** Même format que GET /usual_problem?device_type=... */
export async function mockUsualProblemsResponse({ deviceType }) {
  await simulateLatency(100, 300);
  return MOCK_USUAL_PROBLEMS.filter((item) => item.deviceType === deviceType).map(({ id, label }) => ({ id, label }));
}

/** Même format que GET /usual_problem/{id}/solution. */
export async function mockUsualProblemReplyResponse({ usualProblemId }) {
  await simulateLatency(100, 300);
  return { id: usualProblemId, reply: MOCK_SAVED_REPLY };
}

/* ---------- Propositions de solution ---------- */

const MOCK_PROPOSAL_CONTEXT = {
  context: {
    intervention_id: 3001,
    intervention_symptom_id: 9001,
    symptom_id: 21,
    component_id: 1,
    device_id: null,
    device_type: "gab",
    model_id: null,
    error_code_id: 1,
  },
  problem: {
    label: "Carte retenue par le lecteur",
    description: "le GAB avale la carte du client",
    component_name: "Lecteur de carte",
    device_label: "GAB",
    error_code: "E42",
  },
  reference_position: 1,
  previous_results: [
    { position: 1, kind: "case", intervention_id: 3001, intervention_symptom_id: 9001, symptom_text: "La carte est retenue par le GAB.", solution_text: "Reinitialized card reader." },
    { position: 2, kind: "case", intervention_id: 3045, intervention_symptom_id: 9004, symptom_text: "La carte reste coincée dans le distributeur.", solution_text: "Replaced card-retention sensor." },
  ],
};

const mockProposals = [];

/** Même format que GET /chat/conversations/{id}/solution-proposal-context. */
export async function mockProposalContextResponse({ conversationId }) {
  await simulateLatency(300, 600);
  return { conversation_id: conversationId, ...structuredClone(MOCK_PROPOSAL_CONTEXT) };
}

/** Même format que POST /chat/conversations/{id}/solution-proposals. */
export async function mockSubmitProposalResponse({ conversationId, technicianId, proposedAction, resultDescription, outcomeStatus }) {
  await simulateLatency();
  const proposal = {
    proposal_id: 900 + mockProposals.length,
    status: "pending",
    created_at: new Date().toISOString(),
    conversation_id: conversationId,
    technician_id: technicianId,
    technician_name: `Technicien ${technicianId}`,
    ...MOCK_PROPOSAL_CONTEXT.context,
    component_name: MOCK_PROPOSAL_CONTEXT.problem.component_name,
    model_name: null,
    error_code: MOCK_PROPOSAL_CONTEXT.problem.error_code,
    problem_text: MOCK_PROPOSAL_CONTEXT.problem.description,
    problem_label: MOCK_PROPOSAL_CONTEXT.problem.label,
    proposed_action: proposedAction,
    result_description: resultDescription,
    outcome_status: outcomeStatus,
    previous_results: structuredClone(MOCK_PROPOSAL_CONTEXT.previous_results),
    conversation_context_snapshot: {},
    reviewed_at: null,
    reviewed_by: null,
    admin_comment: null,
    approved_action_id: null,
  };
  mockProposals.unshift(proposal);
  return {
    proposal_id: proposal.proposal_id,
    status: "pending",
    reply: "Votre proposition a été enregistrée et sera examinée par un administrateur. Merci : si elle est validée, elle aidera les prochains techniciens. Vous pouvez continuer la conversation.",
  };
}

/** Même format que GET /admin/solution-proposals (une proposition d'exemple si la liste est vide). */
export async function mockListProposalsResponse({ status }) {
  await simulateLatency(300, 600);
  if (!mockProposals.length) {
    await mockSubmitProposalResponse({
      conversationId: 1,
      technicianId: 7,
      proposedAction: "Nettoyé les contacts du capteur de présence carte à l'air sec",
      resultDescription: "La carte est de nouveau éjectée ; trois transactions de test OK.",
      outcomeStatus: "resolved",
    });
  }
  return structuredClone(mockProposals.filter((proposal) => !status || proposal.status === status));
}

/** Même format que POST /admin/solution-proposals/{id}/approve|reject. */
export async function mockReviewProposalResponse({ proposalId, decision, reviewedBy, adminComment }) {
  await simulateLatency(300, 600);
  const proposal = mockProposals.find((candidate) => candidate.proposal_id === proposalId);
  Object.assign(proposal, {
    status: decision === "approve" ? "approved" : "rejected",
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString(),
    admin_comment: adminComment || null,
    approved_action_id: decision === "approve" ? 99 : null,
  });
  return {
    proposal: structuredClone(proposal),
    knowledge_integration: decision === "approve" ? "action_created" : null,
    attached_intervention_action_id: decision === "approve" ? 7100 : null,
    attached_intervention_id: decision === "approve" ? proposal.intervention_id : null,
  };
}
