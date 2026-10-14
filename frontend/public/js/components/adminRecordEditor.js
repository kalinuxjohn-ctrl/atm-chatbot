/**
 * Éditeur générique de la page Administration : liste d'enregistrements avec
 * ajout, modification et suppression. Sert aux codes d'erreur et aux pannes
 * fréquentes, qui ne diffèrent que par leurs champs (voir pages/admin.js).
 *
 * Le composant ne valide que le strict nécessaire (champs obligatoires) :
 * les vraies règles sont côté backend, dont le message d'erreur est affiché.
 */

import { createElement } from "../utils/dom.js";

/**
 * @typedef {{
 *   name: string,                                   clé JSON envoyée au backend
 *   label: string,
 *   type: "text" | "textarea" | "select" | "number",
 *   options?: [string, string][],                   [valeur, libellé] pour un select
 *   required?: boolean,
 *   maxLength?: number,
 *   hint?: string,
 * }} EditorField
 */

/**
 * @param {{
 *   statusLine: HTMLElement,
 *   list: HTMLElement,
 *   addButton: HTMLButtonElement,
 *   resource: { list: Function, create: Function, update: Function, remove: Function },
 *   getAdminKey: () => string,
 *   fields: EditorField[],
 *   nouns: { one: string, many: string, none: string },   ex. "code d'erreur" / "codes d'erreur" / "Aucun code d'erreur."
 *   renderSummary: (record: object) => { title: string, pills: string[], body: string },
 *   describeError: (error: unknown) => string,
 * }} options
 */
export function createRecordEditor({ statusLine, list, addButton, resource, getAdminKey, fields, nouns, renderSummary, describeError }) {
  let records = [];

  async function load() {
    setStatus("Chargement…");
    list.replaceChildren();
    try {
      records = await resource.list({ adminKey: getAdminKey() });
      renderList();
    } catch (error) {
      setStatus(describeError(error), "error");
    }
  }

  function setStatus(text, tone = "") {
    statusLine.textContent = text;
    statusLine.dataset.tone = tone;
  }

  function renderList() {
    setStatus(records.length ? `${records.length} ${records.length > 1 ? nouns.many : nouns.one}` : nouns.none);
    list.replaceChildren(...records.map(renderCard));
  }

  /* ---------- Affichage ---------- */

  function renderCard(record) {
    const card = createElement("article", "proposal-card record-card");
    const { title, pills, body } = renderSummary(record);

    const header = createElement("header", "proposal-card-header");
    const pillGroup = createElement("div", "record-pills");
    pills.forEach((pill) => pillGroup.append(createElement("span", "proposal-pill is-approved", pill)));
    header.append(createElement("h2", "", title), pillGroup);

    const editButton = createElement("button", "button button-secondary", "Modifier");
    editButton.type = "button";
    editButton.addEventListener("click", () => card.replaceWith(renderForm(record)));
    const actions = createElement("div", "proposal-review-actions");
    actions.append(editButton);

    const text = createElement("div", "proposal-text");
    text.append(createElement("p", "", body || "—"));
    card.append(header, text, actions);
    return card;
  }

  /* ---------- Formulaire (ajout ou modification) ---------- */

  /** @param {object|null} record null = nouvel enregistrement */
  function renderForm(record) {
    const isNew = record === null;
    const form = createElement("form", "proposal-card record-form");
    form.noValidate = true;
    form.append(createElement("h3", "", isNew ? `Nouveau ${nouns.one}` : `Modifier le ${nouns.one}`));

    const inputs = new Map();
    fields.forEach((field) => {
      const { wrapper, input } = createInput(field, record?.[field.name]);
      inputs.set(field.name, input);
      form.append(wrapper);
    });

    const feedback = createElement("p", "form-error");
    feedback.setAttribute("role", "alert");
    feedback.hidden = true;

    const actions = createElement("div", "proposal-review-actions");
    const cancelButton = createElement("button", "button button-secondary", "Annuler");
    cancelButton.type = "button";
    const saveButton = createElement("button", "button button-primary", isNew ? "Ajouter" : "Enregistrer");
    saveButton.type = "submit";
    if (!isNew) actions.append(createDeleteButton(record, feedback));
    actions.append(cancelButton, saveButton);
    form.append(feedback, actions);

    cancelButton.addEventListener("click", () => (isNew ? form.remove() : form.replaceWith(renderCard(record))));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      feedback.hidden = true;
      const missing = fields.find((field) => field.required && !inputs.get(field.name).value.trim());
      if (missing) {
        showFeedback(feedback, `Le champ « ${missing.label} » est obligatoire.`);
        inputs.get(missing.name).focus();
        return;
      }

      const payload = Object.fromEntries(fields.map((field) => [field.name, readValue(field, inputs.get(field.name))]));
      saveButton.disabled = true;
      try {
        const saved = isNew
          ? await resource.create({ adminKey: getAdminKey(), record: payload })
          : await resource.update({ adminKey: getAdminKey(), id: record.id, record: payload });
        records = isNew ? [...records, saved] : records.map((item) => (item.id === saved.id ? saved : item));
        if (isNew) {
          form.remove();
          renderList();
        } else {
          form.replaceWith(renderCard(saved));
        }
      } catch (error) {
        showFeedback(feedback, describeError(error));
        saveButton.disabled = false;
      }
    });

    return form;
  }

  /** Suppression en deux clics : « Supprimer » puis « Confirmer la suppression ». */
  function createDeleteButton(record, feedback) {
    const button = createElement("button", "button button-danger", "Supprimer");
    button.type = "button";
    let armed = false;
    button.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        button.textContent = "Confirmer la suppression";
        return;
      }
      button.disabled = true;
      try {
        await resource.remove({ adminKey: getAdminKey(), id: record.id });
        records = records.filter((item) => item.id !== record.id);
        renderList();
      } catch (error) {
        showFeedback(feedback, describeError(error));
        button.disabled = false;
        armed = false;
        button.textContent = "Supprimer";
      }
    });
    return button;
  }

  addButton.addEventListener("click", () => {
    const existing = list.querySelector(".record-form.is-new");
    if (existing) {
      existing.querySelector("input, select, textarea")?.focus();
      return;
    }
    const form = renderForm(null);
    form.classList.add("is-new");
    list.prepend(form);
    form.querySelector("input, select, textarea")?.focus();
  });

  return { load };
}

function createInput(field, value) {
  const wrapper = createElement("label", "field");
  wrapper.append(createElement("span", "", field.required ? field.label : `${field.label} `));
  if (!field.required) wrapper.firstChild.append(createElement("em", "", "(facultatif)"));

  let input;
  if (field.type === "select") {
    input = createElement("select");
    field.options.forEach(([optionValue, optionLabel]) => {
      const option = createElement("option", "", optionLabel);
      option.value = optionValue;
      input.append(option);
    });
  } else if (field.type === "textarea") {
    input = createElement("textarea");
    input.rows = 6;
  } else {
    input = createElement("input");
    input.type = field.type === "number" ? "number" : "text";
    if (field.type === "number") input.min = "0";
  }
  input.name = field.name;
  if (field.maxLength) input.maxLength = field.maxLength;
  input.value = value === null || value === undefined ? "" : String(value);
  wrapper.append(input);
  if (field.hint) wrapper.append(createElement("small", "", field.hint));
  return { wrapper, input };
}

/** Champ vide -> null (le backend distingue « absent » de « texte ») ; nombre -> entier. */
function readValue(field, input) {
  const raw = input.value.trim();
  if (!raw) return null;
  return field.type === "number" ? Number.parseInt(raw, 10) : raw;
}

function showFeedback(feedback, message) {
  feedback.textContent = message;
  feedback.hidden = false;
}
