/**
 * Rubrique « Ajouts d'intervention » : interventions racontées par les
 * techniciens depuis l’ATM-Chatbot. Approuvée, une demande est écrite dans
 * l'historique (appareil, intervention, symptômes, actions, diagnostic) et
 * les statistiques des solutions sont recalculées.
 *
 * Avant de décider, l'admin peut ouvrir « Ce que l'approbation écrira » :
 * le chatbot calcule l'aperçu (rattachements au catalogue, nouvel appareil…)
 * sans rien écrire.
 * API : /api/atm-chatbot-admin/intervention_add (voir atmChatbotAdminApi.js).
 */

import { createElementWithText } from "/shared/js/domHelpers.js";
import { createIcon } from "/shared/js/icons.js";
import { interventionAddApi } from "./atmChatbotAdminApi.js";
import { connectAdminInterventionForm } from "./adminInterventionForm.js";
import {
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

const FINAL_OUTCOME_LABELS = {
  resolved: "Résolue",
  partially_resolved: "Résolue en partie",
  unresolved: "Non résolue",
  escalated: "Escaladée",
};
const ACTION_OUTCOME_LABELS = {
  resolved: "A réglé le problème",
  partial: "Amélioration partielle",
  no_effect: "Sans effet",
  made_worse: "A aggravé",
  unknown: "Effet inconnu",
};
// Comment chaque symptôme / action sera rattaché au catalogue (champ catalog_link de l'aperçu).
const CATALOG_LINK_LABELS = {
  chosen_by_admin: "choisi par l'admin",
  matched_existing: "déjà au catalogue",
  new_catalog_entry: "nouvelle entrée",
};

/**
 * @param {object} context
 * @param {string} context.reviewerName
 * @param {(count: number) => void} context.showPendingCount
 */
export function createInterventionAddsSection({ reviewerName, showPendingCount }) {
  const sectionElement = document.querySelector('[data-section="interventions"]');
  const statusLine = sectionElement.querySelector('[data-section-status="interventions"]');
  const requestList = sectionElement.querySelector('[data-review-list="interventions"]');
  let selectedStatus = "pending";

  function createSymptomList(symptoms) {
    const symptomList = createElementWithText("ol", "numbered-list");
    for (const symptom of symptoms) {
      const listItem = createElementWithText("li");
      listItem.append(createElementWithText("span", "", symptom.text));
      if (symptom.severity) {
        listItem.append(createElementWithText("small", "muted", `Gravité : ${symptom.severity}`));
      }
      symptomList.append(listItem);
    }
    return symptomList;
  }

  function createActionList(actions) {
    const actionList = createElementWithText("ol", "numbered-list");
    for (const action of actions) {
      const listItem = createElementWithText("li", action.is_confirmed_solution ? "is-confirmed-solution" : "");
      const actionTitle = createElementWithText("span", "numbered-list-title", action.text);
      if (action.is_confirmed_solution) {
        const solutionBadge = createElementWithText("span", "badge badge-accent");
        solutionBadge.append(createIcon("approved"), createElementWithText("span", "", "Solution"));
        actionTitle.append(" ", solutionBadge);
      }
      const details = [
        ACTION_OUTCOME_LABELS[action.outcome_status] ?? action.outcome_status,
        action.targets_symptom_number ? `vise le symptôme ${action.targets_symptom_number}` : "tous les symptômes",
      ].join(" · ");
      listItem.append(actionTitle, createElementWithText("span", "", action.result_description), createElementWithText("small", "muted", details));
      actionList.append(listItem);
    }
    return actionList;
  }

  /** Aperçu de l'écriture, chargé à la première ouverture du bloc (le calcul interroge le catalogue). */
  function createInsertionPreviewDisclosure(interventionAdd) {
    const disclosure = createElementWithText("details", "disclosure");
    disclosure.append(createElementWithText("summary", "", "Ce que l'approbation écrira"));
    const previewBody = createElementWithText("div", "disclosure-body", "Calcul de l'aperçu…");
    disclosure.append(previewBody);
    let isLoaded = false;

    disclosure.addEventListener("toggle", async () => {
      if (!disclosure.open || isLoaded) {
        return;
      }
      isLoaded = true;
      try {
        const preview = await interventionAddApi.preview(interventionAdd.intervention_add_id);
        const device = preview.device;
        const deviceText = device.is_new
          ? `Nouvel appareil ${device.device_type?.toUpperCase() ?? ""}${device.model_name ? ` · ${device.model_name}` : ""}${device.is_new_model ? " (nouveau modèle)" : ""}`
          : `Appareil existant n° ${device.device_id}`;

        const symptomLinks = createElementWithText("ul", "plain-list");
        for (const plannedSymptom of preview.intervention_symptom) {
          symptomLinks.append(
            createElementWithText("li", "", `${plannedSymptom.number}. ${plannedSymptom.catalog_text} — ${CATALOG_LINK_LABELS[plannedSymptom.catalog_link] ?? plannedSymptom.catalog_link}`),
          );
        }
        const actionLinks = createElementWithText("ul", "plain-list");
        for (const plannedAction of preview.intervention_action) {
          actionLinks.append(
            createElementWithText("li", "", `${plannedAction.sequence_order}. ${plannedAction.catalog_text} — ${CATALOG_LINK_LABELS[plannedAction.catalog_link] ?? plannedAction.catalog_link}`),
          );
        }

        previewBody.replaceChildren(
          createFactList([
            ["Appareil", deviceText],
            ["Site", [device.site_name, device.address].filter(Boolean).join(", ")],
            ["Nouveaux symptômes au catalogue", preview.new_catalog_symptoms.length ? preview.new_catalog_symptoms.join(" · ") : "aucun"],
            ["Nouvelles actions au catalogue", preview.new_catalog_actions.length ? preview.new_catalog_actions.join(" · ") : "aucune"],
            ["Statistiques", preview.recomputes_stats ? "recalculées après l'écriture" : null],
          ]),
          createElementWithText("h4", "", "Symptômes → catalogue"),
          symptomLinks,
          createElementWithText("h4", "", "Actions → catalogue"),
          actionLinks,
        );
      } catch (error) {
        isLoaded = false; // nouvel essai à la prochaine ouverture
        previewBody.replaceChildren(createElementWithText("p", "form-error", error.message));
      }
    });
    return disclosure;
  }

  function createInterventionAddCard(interventionAdd) {
    const content = interventionAdd.content;
    const card = createElementWithText("article", "card review-card");

    const header = createElementWithText("header", "review-card-header");
    const titleBlock = createElementWithText("div", "review-card-title");
    titleBlock.append(
      createElementWithText("h3", "", interventionAdd.device_label || "Appareil non précisé"),
      createElementWithText(
        "p",
        "muted",
        interventionAdd.origin === "admin"
          ? `Ajout n° ${interventionAdd.intervention_add_id} · Admin (${interventionAdd.created_by_admin}) · ${formatDateTime(interventionAdd.created_at)}`
          : `Demande n° ${interventionAdd.intervention_add_id} · ${interventionAdd.technician_name || `Technicien ${interventionAdd.technician_id}`} · ${formatDateTime(interventionAdd.created_at)}`,
      ),
    );
    const headerBadges = createElementWithText("div", "review-card-badges");
    if (interventionAdd.origin === "admin") {
      headerBadges.append(createElementWithText("span", "badge badge-accent", "Origine : admin"));
    }
    if (interventionAdd.edited_by_admin) {
      headerBadges.append(createElementWithText("span", "badge", `Corrigée par ${interventionAdd.last_edited_by ?? "un admin"}`));
    }
    headerBadges.append(createStatusPill(interventionAdd.status));
    header.append(titleBlock, headerBadges);

    card.append(
      header,
      createFactList([
        ["Issue", FINAL_OUTCOME_LABELS[content.final_outcome_status] ?? content.final_outcome_status],
        ["Ticket", content.ticket_reference],
        ["Ouverte", interventionAdd.origin === "admin" ? null : formatDateTime(content.opened_at)],
        ["Fermée", interventionAdd.origin === "admin" ? null : formatDateTime(content.closed_at)],
        ["N° de série", content.device?.serial_number],
        ["Conversation", interventionAdd.conversation_id ? `n° ${interventionAdd.conversation_id}` : null],
      ]),
    );
    if (content.summary_text) {
      card.append(createTextBlock("Résumé", content.summary_text));
    }

    const columns = createElementWithText("div", "text-block-pair");
    const symptomsBlock = createElementWithText("div", "text-block");
    symptomsBlock.append(createElementWithText("h4", "", `Problèmes constatés (${content.symptoms.length})`), createSymptomList(content.symptoms));
    const actionsBlock = createElementWithText("div", "text-block");
    actionsBlock.append(createElementWithText("h4", "", `Actions menées (${content.actions.length})`), createActionList(content.actions));
    columns.append(symptomsBlock, actionsBlock);
    card.append(columns);

    if (content.diagnosis) {
      card.append(
        createTextBlock(
          "Diagnostic",
          content.diagnosis.description,
          [content.diagnosis.confirmed ? "Cause confirmée" : "Cause supposée", content.diagnosis.root_cause_component_text].filter(Boolean).join(" · "),
        ),
      );
    }

    if (interventionAdd.status === "pending") {
      card.append(createInsertionPreviewDisclosure(interventionAdd), createInterventionAddDecisionForm(interventionAdd, card));
    } else {
      card.append(
        createFactList([
          ["Décision", `${STATUS_LABELS[interventionAdd.status]} par ${interventionAdd.reviewed_by ?? "?"} · ${formatDateTime(interventionAdd.reviewed_at)}`],
          ["Commentaire", interventionAdd.admin_comment],
          ["Intervention créée", interventionAdd.created_intervention_id ? `n° ${interventionAdd.created_intervention_id}` : null],
        ]),
      );
    }
    return card;
  }

  function createInterventionAddDecisionForm(interventionAdd, card) {
    return createDecisionForm({
      reviewerName,
      onDecision: async (decision, comment) => {
        const decisionBody = { reviewed_by: reviewerName, admin_comment: comment || null };
        const reviewResult = await interventionAddApi.review(interventionAdd.intervention_add_id, decision, decisionBody);
        // L'approbation renvoie { intervention_add, created_intervention_id, … } ; le rejet renvoie la demande seule.
        const updatedInterventionAdd = decision === "approve" ? reviewResult.intervention_add : reviewResult;
        const updatedCard = createInterventionAddCard(updatedInterventionAdd);
        updatedCard.prepend(
          decision === "approve"
            ? createDecisionNotice(`Approuvée : intervention n° ${reviewResult.created_intervention_id} écrite dans l'historique, statistiques recalculées.`)
            : createDecisionNotice("Rejetée : rien n'a été écrit dans l'historique.", { isRejection: true }),
        );
        card.replaceWith(updatedCard);
        refreshPendingCount();
      },
    });
  }

  async function refreshPendingCount() {
    try {
      showPendingCount((await interventionAddApi.list("pending")).length);
    } catch {
      // Compteur seulement.
    }
  }

  async function loadInterventionAdds() {
    showSectionStatus(statusLine, "Chargement…");
    requestList.replaceChildren();
    try {
      const interventionAdds = await interventionAddApi.list(selectedStatus);
      if (selectedStatus === "pending") {
        showPendingCount(interventionAdds.length);
      }
      const statusLabel = STATUS_LABELS[selectedStatus].toLowerCase();
      showSectionStatus(statusLine, interventionAdds.length ? `${interventionAdds.length} demande${interventionAdds.length > 1 ? "s" : ""} · ${statusLabel}` : "");
      requestList.replaceChildren(
        ...(interventionAdds.length
          ? interventionAdds.map(createInterventionAddCard)
          : [createEmptyListMessage(selectedStatus === "pending" ? "inbox" : "history", `Aucune demande ${statusLabel}.`, selectedStatus === "pending" ? "Tout est à jour." : "")]),
      );
    } catch (error) {
      showSectionStatus(statusLine, error.message, { isError: true });
    }
  }

  connectStatusFilter(sectionElement.querySelector('[data-status-filter="interventions"]'), (status) => {
    selectedStatus = status;
    loadInterventionAdds();
  });

  connectAdminInterventionForm(sectionElement, async () => {
    const approvedTab = sectionElement.querySelector('[data-status="approved"]');
    approvedTab.click();
    await refreshPendingCount();
  });

  return { load: loadInterventionAdds, refreshPendingCount };
}
