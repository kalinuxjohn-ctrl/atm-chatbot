/**
 * Rubriques « Codes d'erreur » et « Pannes fréquentes » : réponses que le
 * ATM-Chatbot donne SANS IA, depuis ses menus de suggestions. Les deux ont les
 * mêmes opérations (lister, ajouter, modifier, supprimer) : un seul éditeur
 * générique, configuré par createSavedRepliesSection(...) en bas du fichier.
 * API : /api/atm-chatbot-admin/error_code et /api/atm-chatbot-admin/usual_problem.
 */

import { createButton, createElementWithText } from "/shared/js/domHelpers.js";
import { errorCodeResource, usualProblemResource } from "./atmChatbotAdminApi.js";
import {
  DEVICE_TYPE_LABELS,
  createEmptyListMessage,
  createIconTextButton,
  createTwoStepDeleteButton,
  showSectionStatus,
} from "./administrationWidgets.js";

const REPLY_HINT = "Une ligne = un paragraphe dans le chat. Ex. « 1. Mettez l'appareil hors service. »";

/** Champ de formulaire décrit par { name, label, type, required, maxLength, options, hint }. */
function createFormField(fieldDescription, currentValue) {
  const fieldLabel = createElementWithText("label", `form-field${fieldDescription.type === "textarea" ? " form-field-wide" : ""}`, fieldDescription.label);
  let input;
  if (fieldDescription.type === "select") {
    input = document.createElement("select");
    for (const [optionValue, optionLabel] of fieldDescription.options) {
      input.add(new Option(optionLabel, optionValue, false, String(currentValue ?? "") === optionValue));
    }
  } else if (fieldDescription.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 5;
    input.value = currentValue ?? "";
  } else {
    input = document.createElement("input");
    input.type = fieldDescription.type;
    input.value = currentValue ?? "";
  }
  input.name = fieldDescription.name;
  input.required = Boolean(fieldDescription.required);
  if (fieldDescription.maxLength) {
    input.maxLength = fieldDescription.maxLength;
  }
  fieldLabel.append(input);
  if (fieldDescription.hint) {
    fieldLabel.append(createElementWithText("span", "muted form-field-hint", fieldDescription.hint));
  }
  return fieldLabel;
}

/** Valeurs du formulaire prêtes à envoyer : champ vide -> null, nombre -> Number. */
function readFormValues(formElement, fieldDescriptions) {
  const values = {};
  for (const fieldDescription of fieldDescriptions) {
    const rawValue = formElement.elements[fieldDescription.name].value.trim();
    if (rawValue === "") {
      values[fieldDescription.name] = null;
    } else {
      values[fieldDescription.name] = fieldDescription.type === "number" ? Number(rawValue) : rawValue;
    }
  }
  return values;
}

/**
 * @param {object} configuration
 * @param {string} configuration.sectionName        valeur de data-section dans index.html
 * @param {object} configuration.resource           client { list, create, update, remove }
 * @param {{ one: string, many: string }} configuration.nouns
 * @param {object[]} configuration.fields           champs du formulaire
 * @param {(record) => { title, pills: string[], body }} configuration.describeRecord
 * @param {(count: number) => void} configuration.showRecordCount
 */
function createSavedRepliesSection({ sectionName, resource, nouns, fields, describeRecord, showRecordCount }) {
  const sectionElement = document.querySelector(`[data-section="${sectionName}"]`);
  const statusLine = sectionElement.querySelector(`[data-section-status="${sectionName}"]`);
  const recordList = sectionElement.querySelector(`[data-record-list="${sectionName}"]`);
  const searchInput = sectionElement.querySelector(`[data-record-search="${sectionName}"]`);
  const addButton = sectionElement.querySelector(`[data-record-add="${sectionName}"]`);
  let records = [];

  function matchesSearch(record) {
    const searchedText = searchInput.value.trim().toLowerCase();
    if (!searchedText) {
      return true;
    }
    const { title, pills, body } = describeRecord(record);
    return [title, body, ...pills].join(" ").toLowerCase().includes(searchedText);
  }

  /** Formulaire d'ajout (record = null) ou de modification, à la place de `placeholderElement`. */
  function createRecordForm(record, onClose) {
    const recordForm = createElementWithText("form", "card record-form");
    recordForm.noValidate = true;
    const formTitle = createElementWithText("h3", "", record ? `Modifier « ${describeRecord(record).title} »` : `Nouveau ${nouns.one}`);
    const fieldGrid = createElementWithText("div", "form-grid");
    fieldGrid.append(...fields.map((fieldDescription) => createFormField(fieldDescription, record?.[fieldDescription.name])));
    const errorMessage = createElementWithText("p", "form-error");
    errorMessage.setAttribute("role", "alert");
    errorMessage.hidden = true;
    const actions = createElementWithText("div", "form-actions");
    const saveButton = createButton(record ? "Enregistrer" : "Ajouter", { type: "submit" });
    actions.append(createButton("Annuler", { className: "button button-secondary", onClick: onClose }), saveButton);
    recordForm.append(formTitle, fieldGrid, errorMessage, actions);

    recordForm.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();
      const missingField = fields.find((fieldDescription) => fieldDescription.required && !recordForm.elements[fieldDescription.name].value.trim());
      if (missingField) {
        errorMessage.textContent = `« ${missingField.label} » est obligatoire.`;
        errorMessage.hidden = false;
        recordForm.elements[missingField.name].focus();
        return;
      }
      saveButton.disabled = true;
      errorMessage.hidden = true;
      try {
        const values = readFormValues(recordForm, fields);
        const savedRecord = record ? await resource.update(record.id, values) : await resource.create(values);
        records = record ? records.map((item) => (item.id === record.id ? savedRecord : item)) : [savedRecord, ...records];
        renderRecords();
        showSectionStatus(statusLine, record ? `« ${describeRecord(savedRecord).title} » enregistré.` : `« ${describeRecord(savedRecord).title} » ajouté.`);
      } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
        saveButton.disabled = false;
      }
    });
    return recordForm;
  }

  function createRecordCard(record) {
    const { title, pills, body } = describeRecord(record);
    const card = createElementWithText("article", "card record-card");
    const header = createElementWithText("header", "record-card-header");
    const titleBlock = createElementWithText("div", "record-card-title");
    titleBlock.append(createElementWithText("h3", "", title));
    const pillRow = createElementWithText("div", "record-card-pills");
    pillRow.append(...pills.map((pillText) => createElementWithText("span", "badge", pillText)));
    titleBlock.append(pillRow);

    const actions = createElementWithText("div", "row-actions");
    actions.append(
      createIconTextButton("edit", "Modifier", {
        className: "button button-secondary button-small",
        onClick: () => card.replaceWith(createRecordForm(record, renderRecords)),
      }),
      createTwoStepDeleteButton(async (deleteButton) => {
        deleteButton.disabled = true;
        try {
          await resource.remove(record.id);
          records = records.filter((item) => item.id !== record.id);
          renderRecords();
          showSectionStatus(statusLine, `« ${title} » supprimé.`);
        } catch (error) {
          deleteButton.disabled = false;
          showSectionStatus(statusLine, error.message, { isError: true });
        }
      }),
    );
    header.append(titleBlock, actions);
    card.append(header, createElementWithText("p", "record-card-body", body));
    return card;
  }

  function renderRecords() {
    showRecordCount(records.length);
    addButton.hidden = false;
    const visibleRecords = records.filter(matchesSearch);
    if (!records.length) {
      recordList.replaceChildren(createEmptyListMessage("inbox", `Aucun ${nouns.one} pour l'instant.`));
      return;
    }
    recordList.replaceChildren(
      ...(visibleRecords.length ? visibleRecords.map(createRecordCard) : [createEmptyListMessage("search", "Aucun résultat pour cette recherche.")]),
    );
  }

  async function loadRecords() {
    showSectionStatus(statusLine, "Chargement…");
    try {
      records = await resource.list();
      showSectionStatus(statusLine, "");
      renderRecords();
    } catch (error) {
      showSectionStatus(statusLine, error.message, { isError: true });
    }
  }

  addButton.addEventListener("click", () => {
    addButton.hidden = true;
    const recordForm = createRecordForm(null, renderRecords);
    recordList.prepend(recordForm);
    recordForm.querySelector("input, select, textarea")?.focus();
  });
  searchInput.addEventListener("input", renderRecords);

  return { load: loadRecords };
}

export function createErrorCodesSection({ showRecordCount }) {
  return createSavedRepliesSection({
    sectionName: "codes-erreur",
    resource: errorCodeResource,
    nouns: { one: "code d'erreur", many: "codes d'erreur" },
    showRecordCount,
    fields: [
      { name: "code", label: "Code", type: "text", required: true, maxLength: 50, hint: "Tel qu'affiché par l'équipement, ex. E42." },
      { name: "label", label: "Libellé", type: "text", maxLength: 500, hint: "Affiché dans le menu, à côté du code." },
      {
        name: "device_type",
        label: "Équipement",
        type: "select",
        options: [["", "Aucun (absent du menu de l’ATM-Chatbot)"], ["gab", "GAB"], ["tpe", "TPE"]],
      },
      { name: "reply", label: "Réponse de l’ATM-Chatbot", type: "textarea", maxLength: 5000, hint: REPLY_HINT },
    ],
    describeRecord: (record) => ({
      title: record.label ? `${record.code} — ${record.label}` : record.code,
      pills: [
        record.device_type && record.reply ? `Dans l’ATM-Chatbot · ${DEVICE_TYPE_LABELS[record.device_type]}` : "Absent du menu",
        ...(record.fault ? [`Panne ${record.fault.code || record.fault.name}`] : []),
      ],
      body: record.reply || "Aucune réponse enregistrée.",
    }),
  });
}

export function createUsualProblemsSection({ showRecordCount }) {
  return createSavedRepliesSection({
    sectionName: "pannes-frequentes",
    resource: usualProblemResource,
    nouns: { one: "panne fréquente", many: "pannes fréquentes" },
    showRecordCount,
    fields: [
      { name: "device_type", label: "Équipement", type: "select", required: true, options: [["gab", "GAB"], ["tpe", "TPE"]] },
      { name: "label", label: "Libellé du menu", type: "text", required: true, maxLength: 300, hint: "Ex. « Le GAB a avalé la carte du client »." },
      { name: "display_order", label: "Ordre dans le menu", type: "number", hint: "Vide : en fin de menu." },
      { name: "reply", label: "Réponse de l’ATM-Chatbot", type: "textarea", required: true, maxLength: 5000, hint: REPLY_HINT },
    ],
    describeRecord: (record) => ({
      title: record.label,
      pills: [DEVICE_TYPE_LABELS[record.device_type] ?? record.device_type, `Position ${record.display_order}`],
      body: record.reply,
    }),
  });
}
