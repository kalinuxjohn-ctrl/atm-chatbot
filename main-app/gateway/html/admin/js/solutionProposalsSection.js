/**
 * Rubrique « Propositions de solution » : solutions proposées par les
 * techniciens depuis le Copilote, à approuver (elles rejoignent le catalogue
 * d'actions) ou à rejeter (elles restent dans l'historique).
 * API : /api/copilot-admin/solution-proposals (voir copilotAdminApi.js).
 */

import { createElementWithText } from "/shared/js/domHelpers.js";
import { solutionProposalApi } from "./copilotAdminApi.js";
import {
  DEVICE_TYPE_LABELS,
  STATUS_LABELS,
  connectStatusFilter,
  createDecisionForm,
  createDecisionNotice,
  createEmptyListMessage,
  createFactList,
  createStatusPill,
  createTextBlock,
  formatDateTime,
  showSectionStatus,
} from "./administrationWidgets.js";

const OUTCOME_LABELS = { resolved: "Problème réglé", partial: "Réglé en partie" };
// Ce que le chatbot a fait de la solution approuvée (champ knowledge_integration).
const KNOWLEDGE_INTEGRATION_MESSAGES = {
  action_created: "Approuvée : une nouvelle action a été ajoutée au catalogue.",
  existing_action_reused: "Approuvée : une action équivalente existait déjà, elle a été réutilisée (pas de doublon).",
  existing_action_linked: "Approuvée et rattachée à l'action choisie.",
};

/**
 * @param {object} context
 * @param {string} context.reviewerName              signe les décisions (nom de l'admin connecté)
 * @param {(count: number) => void} context.showPendingCount  met à jour le compteur du sommaire
 */
export function createSolutionProposalsSection({ reviewerName, showPendingCount }) {
  const sectionElement = document.querySelector('[data-section="propositions"]');
  const statusLine = sectionElement.querySelector('[data-section-status="propositions"]');
  const proposalList = sectionElement.querySelector('[data-review-list="propositions"]');
  let selectedStatus = "pending";

  function createProposalCard(proposal) {
    const card = createElementWithText("article", "card review-card");

    const header = createElementWithText("header", "review-card-header");
    const titleBlock = createElementWithText("div", "review-card-title");
    titleBlock.append(
      createElementWithText("h3", "", proposal.problem_label || "Problème sans libellé"),
      createElementWithText(
        "p",
        "muted",
        `n° ${proposal.proposal_id} · ${proposal.technician_name || `Technicien ${proposal.technician_id}`} · ${formatDateTime(proposal.created_at)}`,
      ),
    );
    header.append(titleBlock, createStatusPill(proposal.status));

    const referenceCase = proposal.intervention_id
      ? `Intervention n° ${proposal.intervention_id}${proposal.intervention_symptom_id ? ` (symptôme n° ${proposal.intervention_symptom_id})` : ""}`
      : "Aucun cas passé trouvé";
    const facts = createFactList([
      ["Équipement", [DEVICE_TYPE_LABELS[proposal.device_type] ?? proposal.device_type, proposal.model_name].filter(Boolean).join(" · ")],
      ["Appareil", proposal.device_id ? `n° ${proposal.device_id}` : null],
      ["Composant", proposal.component_name],
      ["Code d'erreur", proposal.error_code],
      ["Cas de référence", referenceCase],
      ["Conversation", proposal.conversation_id ? `n° ${proposal.conversation_id}` : null],
    ]);

    const problemBlock = createTextBlock("Problème décrit", proposal.problem_text);
    const texts = createElementWithText("div", "text-block-pair");
    texts.append(
      createTextBlock("Solution proposée", proposal.proposed_action),
      createTextBlock("Résultat obtenu", proposal.result_description, OUTCOME_LABELS[proposal.outcome_status] ?? proposal.outcome_status ?? ""),
    );
    card.append(header, facts, problemBlock, texts);

    if (proposal.previous_results?.length) {
      const previousResults = createElementWithText("details", "disclosure");
      previousResults.append(createElementWithText("summary", "", `Solutions déjà proposées par le Copilote (${proposal.previous_results.length})`));
      const resultList = createElementWithText("ol", "numbered-list");
      for (const previousResult of proposal.previous_results) {
        const listItem = createElementWithText("li");
        listItem.append(createElementWithText("span", "", previousResult.solution_text || "Solution non précisée"));
        const origin = [previousResult.symptom_text, previousResult.intervention_id ? `intervention n° ${previousResult.intervention_id}` : null]
          .filter(Boolean)
          .join(" · ");
        if (origin) {
          listItem.append(createElementWithText("small", "muted", origin));
        }
        resultList.append(listItem);
      }
      previousResults.append(resultList);
      card.append(previousResults);
    }

    const contextSnapshot = createElementWithText("details", "disclosure");
    contextSnapshot.append(
      createElementWithText("summary", "", "Contexte de la conversation au moment de la proposition"),
      createElementWithText("pre", "code-block", JSON.stringify(proposal.conversation_context_snapshot, null, 2)),
    );
    card.append(contextSnapshot);

    card.append(proposal.status === "pending" ? createProposalDecisionForm(proposal, card) : createDecisionSummary(proposal));
    return card;
  }

  function createDecisionSummary(proposal) {
    return createFactList([
      ["Décision", `${STATUS_LABELS[proposal.status]} par ${proposal.reviewed_by ?? "?"} · ${formatDateTime(proposal.reviewed_at)}`],
      ["Commentaire", proposal.admin_comment],
      ["Action du catalogue", proposal.approved_action_id ? `n° ${proposal.approved_action_id}` : null],
    ]);
  }

  function createProposalDecisionForm(proposal, card) {
    // Libellé que prendra l'action au catalogue, pré-rempli avec le texte du technicien.
    const catalogLabelField = createElementWithText("label", "form-field", "Libellé au catalogue (si approuvée)");
    const catalogLabelInput = document.createElement("input");
    catalogLabelInput.maxLength = 500;
    catalogLabelInput.value = (proposal.proposed_action ?? "").slice(0, 500);
    catalogLabelField.append(catalogLabelInput);

    return createDecisionForm({
      reviewerName,
      extraFields: [catalogLabelField],
      onDecision: async (decision, comment) => {
        const decisionBody = { reviewed_by: reviewerName, admin_comment: comment || null };
        if (decision === "approve" && catalogLabelInput.value.trim()) {
          decisionBody.canonical_text = catalogLabelInput.value.trim();
        }
        const reviewResult = await solutionProposalApi.review(proposal.proposal_id, decision, decisionBody);
        const updatedCard = createProposalCard(reviewResult.proposal);
        const attachmentText = reviewResult.attached_intervention_id
          ? ` Rattachée au problème de l'intervention n° ${reviewResult.attached_intervention_id} : le Copilote la proposera dès qu'il retrouvera ce problème.`
          : " Aucun cas de référence : elle reste au catalogue sans être proposée dans le chat.";
        updatedCard.prepend(
          decision === "approve"
            ? createDecisionNotice(`${KNOWLEDGE_INTEGRATION_MESSAGES[reviewResult.knowledge_integration] ?? "Approuvée."}${attachmentText}`)
            : createDecisionNotice("Rejetée : la proposition reste dans l'historique.", { isRejection: true }),
        );
        card.replaceWith(updatedCard);
        if (selectedStatus === "pending") {
          refreshPendingCount();
        }
      },
    });
  }

  async function refreshPendingCount() {
    try {
      showPendingCount((await solutionProposalApi.list("pending")).length);
    } catch {
      // Compteur seulement : l'erreur s'affiche à l'ouverture de la rubrique.
    }
  }

  async function loadProposals() {
    showSectionStatus(statusLine, "Chargement…");
    proposalList.replaceChildren();
    try {
      const proposals = await solutionProposalApi.list(selectedStatus);
      if (selectedStatus === "pending") {
        showPendingCount(proposals.length);
      }
      const statusLabel = STATUS_LABELS[selectedStatus].toLowerCase();
      showSectionStatus(statusLine, proposals.length ? `${proposals.length} proposition${proposals.length > 1 ? "s" : ""} · ${statusLabel}` : "");
      proposalList.replaceChildren(
        ...(proposals.length
          ? proposals.map(createProposalCard)
          : [createEmptyListMessage(selectedStatus === "pending" ? "inbox" : "history", `Aucune proposition ${statusLabel}.`, selectedStatus === "pending" ? "Tout est à jour." : "")]),
      );
    } catch (error) {
      showSectionStatus(statusLine, error.message, { isError: true });
    }
  }

  connectStatusFilter(sectionElement.querySelector('[data-status-filter="propositions"]'), (status) => {
    selectedStatus = status;
    loadProposals();
  });

  return { load: loadProposals, refreshPendingCount };
}
