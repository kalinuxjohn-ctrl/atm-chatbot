/**
 * Page Administration, trois rubriques protégées par la clé ADMIN_API_KEY du serveur :
 * - Propositions     : examen des solutions proposées par les techniciens
 *                      (/api/admin/solution-proposals, services/api/adminProposalApi.js) ;
 * - Codes d'erreur   : ajout / modification / suppression (/api/admin/error_code) ;
 * - Pannes fréquentes : idem (/api/admin/usual_problem).
 * Les deux dernières alimentent les menus de suggestions du Copilote
 * (services/api/adminCatalogApi.js, components/adminRecordEditor.js).
 *
 * La page ne décide de rien : elle affiche ce que le backend renvoie et
 * transmet les décisions et modifications de l'admin.
 */

import { STORAGE_KEYS } from "../config.js";
import { getFriendlyErrorMessage } from "../core/httpClient.js";
import { createRecordEditor } from "../components/adminRecordEditor.js";
import { adminErrorCodes, adminUsualProblems } from "../services/api/adminCatalogApi.js";
import { listProposals, reviewProposal } from "../services/api/adminProposalApi.js";
import { createElement } from "../utils/dom.js";

const accessForm = document.querySelector("#admin-access-form");
const adminKeyInput = document.querySelector("#admin-key");
const reviewerInput = document.querySelector("#reviewer-name");
const statusLine = document.querySelector("#admin-status");
const list = document.querySelector("#proposal-list");
const tabs = [...document.querySelectorAll(".admin-tab")];
const sectionTabs = [...document.querySelectorAll(".admin-section-tab")];

const STATUS_LABELS = { pending: "En attente", approved: "Approuvée", rejected: "Rejetée" };
const OUTCOME_LABELS = { resolved: "Problème réglé", partial: "Réglé en partie" };
const INTEGRATION_MESSAGES = {
  action_created: "Approuvée : une nouvelle action a été ajoutée au catalogue.",
  existing_action_reused: "Approuvée : une action équivalente existait déjà au catalogue, elle a été réutilisée (pas de doublon).",
  existing_action_linked: "Approuvée et rattachée à l’action choisie.",
};

let currentStatus = "pending";
let currentSection = "proposals";

/* ---------- Mémoire de l'onglet (clé et signature) ---------- */

function readSession(key) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : la valeur reste dans le champ */
  }
}

adminKeyInput.value = readSession(STORAGE_KEYS.adminKey);
reviewerInput.value = readSession(STORAGE_KEYS.adminReviewer);

/* ---------- Chargement ---------- */

function describeError(error) {
  if (error?.status === 403) return error.detail || "Clé administrateur invalide.";
  if (error?.detail && [404, 409, 422].includes(error.status)) return error.detail;
  return getFriendlyErrorMessage(error);
}

async function loadProposals() {
  statusLine.textContent = "Chargement…";
  statusLine.dataset.tone = "";
  list.replaceChildren();
  try {
    const proposals = await listProposals({ adminKey: adminKeyInput.value.trim(), status: currentStatus });
    statusLine.textContent = proposals.length
      ? `${proposals.length} proposition${proposals.length > 1 ? "s" : ""} · ${STATUS_LABELS[currentStatus].toLowerCase()}`
      : `Aucune proposition ${STATUS_LABELS[currentStatus].toLowerCase()}.`;
    list.replaceChildren(...proposals.map(renderProposal));
  } catch (error) {
    statusLine.textContent = describeError(error);
    statusLine.dataset.tone = "error";
  }
}

/* ---------- Affichage d'une proposition ---------- */

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function detailsList(rows) {
  const dl = createElement("dl", "proposal-facts");
  rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .forEach(([label, value]) => dl.append(createElement("dt", "", label), createElement("dd", "", String(value))));
  return dl;
}

function textBlock(title, text, extra) {
  const block = createElement("div", "proposal-text");
  block.append(createElement("h3", "", title), createElement("p", "", text));
  if (extra) block.append(createElement("p", "proposal-text-extra", extra));
  return block;
}

function renderProposal(proposal) {
  const card = createElement("article", "proposal-card");
  card.dataset.status = proposal.status;

  const header = createElement("header", "proposal-card-header");
  const title = createElement("div");
  title.append(
    createElement("h2", "", proposal.problem_label),
    createElement(
      "p",
      "proposal-meta",
      `Proposition n° ${proposal.proposal_id} · ${proposal.technician_name || `Technicien ${proposal.technician_id}`} · ${formatDate(proposal.created_at)}`,
    ),
  );
  header.append(title, createElement("span", `proposal-pill is-${proposal.status}`, STATUS_LABELS[proposal.status]));

  const reference = proposal.intervention_id
    ? `Intervention n° ${proposal.intervention_id}${proposal.intervention_symptom_id ? ` (symptôme n° ${proposal.intervention_symptom_id})` : ""}`
    : "Aucun cas passé trouvé";
  const facts = detailsList([
    ["Problème décrit", proposal.problem_text],
    ["Équipement", [proposal.device_type?.toUpperCase(), proposal.model_name].filter(Boolean).join(" · ")],
    ["Appareil", proposal.device_id ? `n° ${proposal.device_id}` : null],
    ["Composant", proposal.component_name],
    ["Code d’erreur", proposal.error_code],
    ["Cas de référence", reference],
    ["Conversation", `n° ${proposal.conversation_id}`],
  ]);

  const proposalTexts = createElement("div", "proposal-texts");
  proposalTexts.append(
    textBlock("Solution proposée", proposal.proposed_action),
    textBlock("Résultat obtenu", proposal.result_description, OUTCOME_LABELS[proposal.outcome_status] || proposal.outcome_status),
  );

  card.append(header, facts, proposalTexts);

  if (proposal.previous_results?.length) {
    const previous = createElement("details", "proposal-section");
    previous.append(createElement("summary", "", `Solutions déjà proposées par le Copilote (${proposal.previous_results.length})`));
    const ol = createElement("ol");
    proposal.previous_results.forEach((result) => {
      const item = createElement("li");
      item.append(createElement("span", "", result.solution_text || "Solution non précisée"));
      const origin = [result.symptom_text, result.intervention_id ? `intervention n° ${result.intervention_id}` : null].filter(Boolean).join(" · ");
      if (origin) item.append(createElement("small", "", origin));
      ol.append(item);
    });
    previous.append(ol);
    card.append(previous);
  }

  const snapshot = createElement("details", "proposal-section");
  snapshot.append(createElement("summary", "", "Contexte de conversation au moment de la proposition"));
  const messageIds = proposal.conversation_context_snapshot?.recent_message_ids || [];
  if (messageIds.length) snapshot.append(createElement("p", "proposal-text-extra", `Messages de référence : ${messageIds.join(", ")}`));
  snapshot.append(createElement("pre", "proposal-snapshot", JSON.stringify(proposal.conversation_context_snapshot, null, 2)));
  card.append(snapshot);

  card.append(proposal.status === "pending" ? renderReviewForm(proposal, card) : renderDecision(proposal));
  return card;
}

function renderDecision(proposal) {
  return detailsList([
    ["Décision", `${STATUS_LABELS[proposal.status]} par ${proposal.reviewed_by} · ${formatDate(proposal.reviewed_at)}`],
    ["Commentaire", proposal.admin_comment],
    ["Action du catalogue", proposal.approved_action_id ? `n° ${proposal.approved_action_id}` : null],
  ]);
}

/* ---------- Décision ---------- */

function renderReviewForm(proposal, card) {
  const form = createElement("form", "proposal-review");
  form.noValidate = true;
  const id = proposal.proposal_id;

  const canonicalField = createElement("label", "field");
  const canonicalInput = createElement("input");
  canonicalInput.id = `canonical-${id}`;
  canonicalInput.name = "canonicalText";
  canonicalInput.maxLength = 500;
  canonicalInput.value = proposal.proposed_action.slice(0, 500);
  canonicalField.append(createElement("span", "", "Libellé au catalogue (si approuvée)"), canonicalInput);

  const commentField = createElement("label", "field");
  const commentInput = createElement("textarea");
  commentInput.id = `comment-${id}`;
  commentInput.name = "adminComment";
  commentInput.rows = 2;
  commentInput.maxLength = 2000;
  commentInput.placeholder = "Obligatoire pour un rejet";
  commentField.append(createElement("span", "", "Commentaire"), commentInput);

  const feedback = createElement("p", "form-error");
  feedback.setAttribute("role", "alert");
  feedback.hidden = true;

  const actions = createElement("div", "proposal-review-actions");
  const rejectButton = createElement("button", "button button-secondary", "Rejeter");
  rejectButton.type = "button";
  const approveButton = createElement("button", "button button-primary", "Approuver");
  approveButton.type = "button";
  actions.append(rejectButton, approveButton);

  async function decide(decision) {
    const reviewedBy = reviewerInput.value.trim();
    const adminComment = commentInput.value.trim();
    feedback.hidden = true;
    if (!reviewedBy) {
      feedback.textContent = "Indiquez votre nom en haut de la page : il signe la décision.";
      feedback.hidden = false;
      reviewerInput.focus();
      return;
    }
    if (decision === "reject" && !adminComment) {
      feedback.textContent = "Expliquez la raison du rejet : le technicien et l’historique en ont besoin.";
      feedback.hidden = false;
      commentInput.focus();
      return;
    }

    writeSession(STORAGE_KEYS.adminReviewer, reviewedBy);
    [rejectButton, approveButton].forEach((button) => (button.disabled = true));
    approveButton.textContent = decision === "approve" ? "Approbation…" : "Approuver";
    rejectButton.textContent = decision === "reject" ? "Rejet…" : "Rejeter";
    try {
      const { proposal: reviewed, knowledgeIntegration, attachedInterventionId } = await reviewProposal({
        adminKey: adminKeyInput.value.trim(),
        proposalId: id,
        decision,
        reviewedBy,
        adminComment,
        canonicalText: canonicalInput.value.trim(),
      });
      const updated = renderProposal(reviewed);
      const attachment = attachedInterventionId
        ? ` Elle est rattachée au problème de l’intervention n° ${attachedInterventionId} : le Copilote la proposera dès qu’il retrouvera ce problème.`
        : " Aucun cas de référence : elle reste au catalogue, sans être proposée dans le chat.";
      const notice = createElement(
        "p",
        "proposal-notice",
        decision === "approve"
          ? `${INTEGRATION_MESSAGES[knowledgeIntegration] || "Approuvée."}${attachment}`
          : "Rejetée : la proposition reste dans l’historique.",
      );
      updated.prepend(notice);
      card.replaceWith(updated);
    } catch (error) {
      feedback.textContent = describeError(error);
      feedback.hidden = false;
      [rejectButton, approveButton].forEach((button) => (button.disabled = false));
      approveButton.textContent = "Approuver";
      rejectButton.textContent = "Rejeter";
    }
  }

  rejectButton.addEventListener("click", () => void decide("reject"));
  approveButton.addEventListener("click", () => void decide("approve"));
  form.addEventListener("submit", (event) => event.preventDefault());

  form.append(createElement("h3", "", "Votre décision"), canonicalField, commentField, feedback, actions);
  return form;
}

/* ---------- Codes d'erreur et pannes fréquentes ---------- */

const DEVICE_LABELS = { gab: "GAB", tpe: "TPE" };
const getAdminKey = () => adminKeyInput.value.trim();
const REPLY_HINT = "Une ligne = un paragraphe dans le chat. Ex. « 1. Mettez l’appareil hors service. »";

const errorCodeEditor = createRecordEditor({
  statusLine: document.querySelector("#error-code-status"),
  list: document.querySelector("#error-code-list"),
  addButton: document.querySelector("#error-code-add"),
  resource: adminErrorCodes,
  getAdminKey,
  describeError,
  nouns: { one: "code d’erreur", many: "codes d’erreur", none: "Aucun code d’erreur." },
  fields: [
    { name: "code", label: "Code", type: "text", required: true, maxLength: 50, hint: "Tel qu’affiché par l’équipement, ex. E42." },
    { name: "label", label: "Libellé", type: "text", maxLength: 500, hint: "Affiché dans le menu, à côté du code." },
    {
      name: "device_type",
      label: "Équipement",
      type: "select",
      options: [["", "Aucun (absent du menu du Copilote)"], ["gab", "GAB"], ["tpe", "TPE"]],
    },
    { name: "reply", label: "Réponse du Copilote", type: "textarea", maxLength: 5000, hint: REPLY_HINT },
  ],
  renderSummary: (record) => ({
    title: record.label ? `${record.code} — ${record.label}` : record.code,
    pills: [
      record.device_type && record.reply ? `Copilote · ${DEVICE_LABELS[record.device_type]}` : "Absent du Copilote",
      ...(record.fault ? [`Panne ${record.fault.code || record.fault.name}`] : []),
    ],
    body: record.reply || "Aucune réponse enregistrée.",
  }),
});

const usualProblemEditor = createRecordEditor({
  statusLine: document.querySelector("#usual-problem-status"),
  list: document.querySelector("#usual-problem-list"),
  addButton: document.querySelector("#usual-problem-add"),
  resource: adminUsualProblems,
  getAdminKey,
  describeError,
  nouns: { one: "panne fréquente", many: "pannes fréquentes", none: "Aucune panne fréquente." },
  fields: [
    { name: "device_type", label: "Équipement", type: "select", required: true, options: [["gab", "GAB"], ["tpe", "TPE"]] },
    { name: "label", label: "Libellé du menu", type: "text", required: true, maxLength: 300, hint: "Ex. « Le GAB a avalé la carte du client »." },
    { name: "display_order", label: "Ordre dans le menu", type: "number", hint: "Vide : en fin de menu." },
    { name: "reply", label: "Réponse du Copilote", type: "textarea", required: true, maxLength: 5000, hint: REPLY_HINT },
  ],
  renderSummary: (record) => ({
    title: record.label,
    pills: [DEVICE_LABELS[record.device_type] || record.device_type, `Position ${record.display_order}`],
    body: record.reply,
  }),
});

function loadCurrentSection() {
  if (currentSection === "error-codes") return errorCodeEditor.load();
  if (currentSection === "usual-problems") return usualProblemEditor.load();
  return loadProposals();
}

/* ---------- Événements ---------- */

accessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  writeSession(STORAGE_KEYS.adminKey, adminKeyInput.value.trim());
  writeSession(STORAGE_KEYS.adminReviewer, reviewerInput.value.trim());
  void loadCurrentSection();
});

sectionTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentSection = tab.dataset.section;
    sectionTabs.forEach((other) => {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      document.querySelector(`#${other.getAttribute("aria-controls")}`).hidden = !selected;
    });
    // Rechargée à chaque ouverture : un autre administrateur a pu modifier la liste.
    if (adminKeyInput.value.trim()) void loadCurrentSection();
  });
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentStatus = tab.dataset.status;
    tabs.forEach((other) => other.setAttribute("aria-selected", String(other === tab)));
    void loadProposals();
  });
});

if (adminKeyInput.value) void loadCurrentSection();
