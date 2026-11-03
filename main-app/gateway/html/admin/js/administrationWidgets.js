/**
 * Petits éléments d'interface partagés par les rubriques de l'administration.
 * Tout texte venant du serveur est inséré avec textContent (createElementWithText) :
 * jamais d'innerHTML, comme dans le reste de la main app.
 */

import { createElementWithText } from "/shared/js/domHelpers.js";
import { createIcon } from "/shared/js/icons.js";

export const STATUS_LABELS = { pending: "En attente", approved: "Approuvée", rejected: "Rejetée" };
const STATUS_ICON_NAMES = { pending: "clock", approved: "approved", rejected: "rejected" };
export const DEVICE_TYPE_LABELS = { gab: "GAB", tpe: "TPE" };

/** « 3 nov. 2026, 14:05 » ; chaîne vide si la date manque. */
export function formatDateTime(isoDateText) {
  if (!isoDateText) {
    return "";
  }
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(isoDateText));
}

/** Pastille de statut d'une demande (en attente / approuvée / rejetée), avec son icône. */
export function createStatusPill(status) {
  const pill = createElementWithText("span", `status-pill status-pill-${status}`);
  pill.append(createIcon(STATUS_ICON_NAMES[status] ?? "dot"), createElementWithText("span", "", STATUS_LABELS[status] ?? status));
  return pill;
}

/** Liste « libellé : valeur » ; les lignes sans valeur sont omises. */
export function createFactList(rows) {
  const factList = createElementWithText("dl", "fact-list");
  for (const [label, value] of rows) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    const factItem = createElementWithText("div", "fact-list-item");
    factItem.append(createElementWithText("dt", "", label), createElementWithText("dd", "", String(value)));
    factList.append(factItem);
  }
  return factList;
}

/** Bloc titré de texte libre (le texte garde ses retours à la ligne). */
export function createTextBlock(title, text, footnote = "") {
  const textBlock = createElementWithText("div", "text-block");
  textBlock.append(createElementWithText("h4", "", title), createElementWithText("p", "", text || "Non précisé."));
  if (footnote) {
    textBlock.append(createElementWithText("p", "text-block-footnote", footnote));
  }
  return textBlock;
}

/** Ligne d'état d'une rubrique (« Chargement… », « 3 propositions », erreur). */
export function showSectionStatus(statusElement, message, { isError = false } = {}) {
  statusElement.textContent = message;
  statusElement.hidden = !message;
  statusElement.classList.toggle("is-error", isError);
}

/** Message d'une liste vide, avec une icône. */
export function createEmptyListMessage(iconName, title, detail = "") {
  const emptyState = createElementWithText("div", "card empty-state");
  emptyState.append(createIcon(iconName), createElementWithText("strong", "", title));
  if (detail) {
    emptyState.append(createElementWithText("span", "", detail));
  }
  return emptyState;
}

/** Bouton avec icône à gauche. */
export function createIconTextButton(iconName, label, { className = "button", onClick = null } = {}) {
  const button = createElementWithText("button", className);
  button.type = "button";
  button.append(createIcon(iconName), createElementWithText("span", "", label));
  if (onClick) {
    button.addEventListener("click", onClick);
  }
  return button;
}

/**
 * Bouton de suppression en deux temps, sans boîte de dialogue du navigateur :
 * 1er clic -> « Confirmer ? » pendant 4 s ; 2e clic -> onConfirm().
 */
export function createTwoStepDeleteButton(onConfirm) {
  const CONFIRMATION_DELAY_MILLISECONDS = 4000;
  const deleteButton = createIconTextButton("trash", "Supprimer", { className: "button button-secondary button-small button-danger-text" });
  let confirmationTimer = null;
  deleteButton.addEventListener("click", () => {
    if (confirmationTimer === null) {
      deleteButton.lastElementChild.textContent = "Confirmer ?";
      deleteButton.classList.add("is-confirming");
      confirmationTimer = window.setTimeout(() => {
        confirmationTimer = null;
        deleteButton.lastElementChild.textContent = "Supprimer";
        deleteButton.classList.remove("is-confirming");
      }, CONFIRMATION_DELAY_MILLISECONDS);
      return;
    }
    window.clearTimeout(confirmationTimer);
    confirmationTimer = null;
    onConfirm(deleteButton);
  });
  return deleteButton;
}

/**
 * Formulaire de décision commun aux propositions et aux ajouts d'intervention :
 * commentaire (obligatoire pour un rejet), boutons Rejeter / Approuver.
 *
 * @param {object} options
 * @param {string} options.reviewerName       nom de l'administrateur connecté, signe la décision
 * @param {HTMLElement[]} [options.extraFields] champs propres à la rubrique, placés avant le commentaire
 * @param {(decision: "approve"|"reject", comment: string) => Promise<void>} options.onDecision
 */
export function createDecisionForm({ reviewerName, extraFields = [], onDecision }) {
  const decisionForm = createElementWithText("form", "decision-form");
  decisionForm.noValidate = true;

  const heading = createElementWithText("div", "decision-form-heading");
  heading.append(
    createElementWithText("h4", "", "Votre décision"),
    createElementWithText("span", "muted", `Signée ${reviewerName}`),
  );

  const commentField = createElementWithText("label", "form-field", "Commentaire");
  const commentInput = document.createElement("textarea");
  commentInput.rows = 2;
  commentInput.maxLength = 2000;
  commentInput.placeholder = "Obligatoire pour un rejet : le technicien et l'historique en ont besoin.";
  commentField.append(commentInput);

  const errorMessage = createElementWithText("p", "form-error");
  errorMessage.setAttribute("role", "alert");
  errorMessage.hidden = true;

  const rejectButton = createIconTextButton("close", "Rejeter", { className: "button button-secondary" });
  const approveButton = createIconTextButton("check", "Approuver");
  const actions = createElementWithText("div", "form-actions");
  actions.append(rejectButton, approveButton);

  async function decide(decision) {
    const comment = commentInput.value.trim();
    errorMessage.hidden = true;
    if (decision === "reject" && !comment) {
      errorMessage.textContent = "Expliquez la raison du rejet.";
      errorMessage.hidden = false;
      commentInput.focus();
      return;
    }
    const clickedButton = decision === "approve" ? approveButton : rejectButton;
    const originalLabel = clickedButton.lastElementChild.textContent;
    rejectButton.disabled = true;
    approveButton.disabled = true;
    clickedButton.lastElementChild.textContent = decision === "approve" ? "Approbation…" : "Rejet…";
    try {
      await onDecision(decision, comment);
    } catch (error) {
      errorMessage.textContent = error.message;
      errorMessage.hidden = false;
      rejectButton.disabled = false;
      approveButton.disabled = false;
      clickedButton.lastElementChild.textContent = originalLabel;
    }
  }

  rejectButton.addEventListener("click", () => decide("reject"));
  approveButton.addEventListener("click", () => decide("approve"));
  decisionForm.addEventListener("submit", (submitEvent) => submitEvent.preventDefault());

  decisionForm.append(heading, ...extraFields, commentField, errorMessage, actions);
  return decisionForm;
}

/** Bandeau de résultat posé en haut d'une carte après une décision. */
export function createDecisionNotice(text, { isRejection = false } = {}) {
  const notice = createElementWithText("p", isRejection ? "decision-notice is-rejection" : "decision-notice");
  notice.append(createIcon(isRejection ? "rejected" : "approved"), createElementWithText("span", "", text));
  notice.setAttribute("role", "status");
  return notice;
}

/**
 * Filtre de statut (boutons « En attente / Approuvées / Rejetées ») d'une rubrique.
 * Appelle onChange(status) au clic.
 */
export function connectStatusFilter(filterElement, onChange) {
  const statusButtons = [...filterElement.querySelectorAll("[data-status]")];
  for (const statusButton of statusButtons) {
    statusButton.addEventListener("click", () => {
      for (const otherButton of statusButtons) {
        otherButton.setAttribute("aria-selected", String(otherButton === statusButton));
      }
      onChange(statusButton.dataset.status);
    });
  }
}
