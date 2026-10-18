import { getFriendlyErrorMessage } from "../core/httpClient.js";
import { submitInterventionAdd } from "../services/api/interventionAddApi.js";
import { createElement } from "../utils/dom.js";
import { createIcon } from "./icons.js";

const MAX_SYMPTOMS = 20;
const MAX_ACTIONS = 30;
const ACTION_OUTCOMES = [
  ["unknown", "Résultat non déterminé"],
  ["resolved", "Problème résolu"],
  ["partial", "Amélioration partielle"],
  ["no_effect", "Sans effet"],
  ["made_worse", "Problème aggravé"],
];

export function createInterventionAddDialog({ dialog, onSubmitted = () => {} }) {
  const form = dialog.querySelector("[data-intervention-form]");
  const fields = dialog.querySelector("[data-intervention-fields]");
  const symptoms = dialog.querySelector("[data-intervention-symptoms]");
  const actions = dialog.querySelector("[data-intervention-actions]");
  const errorBox = dialog.querySelector("[data-intervention-error]");
  const success = dialog.querySelector("[data-intervention-success]");
  const submit = dialog.querySelector("[data-intervention-submit]");
  const cancel = dialog.querySelector("[data-intervention-cancel]");
  const addSymptom = dialog.querySelector("[data-add-symptom]");
  const addAction = dialog.querySelector("[data-add-action]");
  let target = null;
  let sequence = 0;
  let submitting = false;
  let opener = null;

  function showError(message, control = null) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
    if (message) {
      if (control) control.focus();
      else errorBox.scrollIntoView({ block: "nearest" });
    }
  }

  function field(label, tag, key, { required = false, maxLength = null, options = null } = {}) {
    const wrapper = createElement("label", "field", label);
    const control = createElement(tag);
    control.dataset.field = key;
    control.required = required;
    if (maxLength !== null) control.maxLength = maxLength;
    if (tag === "textarea") control.rows = 2;
    if (options) {
      for (const [value, text] of options) control.add(new Option(text, value));
    }
    wrapper.append(control);
    return wrapper;
  }

  function get(row, key) {
    return row.querySelector(`[data-field="${key}"]`);
  }

  function refreshRows() {
    const symptomRows = [...symptoms.children];
    symptomRows.forEach((row, index) => {
      row.querySelector("legend").textContent = `Symptôme ${index + 1}`;
      row.querySelector("[data-remove]").disabled = symptomRows.length === 1;
    });
    [...actions.children].forEach((row, index) => {
      row.querySelector("legend").textContent = `Action ${index + 1}`;
      row.querySelector("[data-remove]").disabled = actions.children.length === 1;
      const select = get(row, "target");
      const value = select.value;
      select.replaceChildren(new Option("Tous les symptômes", ""));
      symptomRows.forEach((symptom, number) => select.add(new Option(`Symptôme ${number + 1}`, symptom.dataset.key)));
      select.value = value;
    });
    addSymptom.disabled = symptomRows.length >= MAX_SYMPTOMS;
    addAction.disabled = actions.children.length >= MAX_ACTIONS;
  }

  function createRow(container, kind) {
    const row = createElement("fieldset", "intervention-entry");
    row.dataset.key = String(++sequence);
    row.append(createElement("legend"));
    const remove = createElement("button", "intervention-remove");
    remove.type = "button";
    remove.dataset.remove = "";
    remove.append(createIcon("close"), createElement("span", "", "Retirer"));
    remove.addEventListener("click", () => {
      if (kind === "symptom") {
        const linked = [...actions.children].map((action) => get(action, "target")).find((select) => select.value === row.dataset.key);
        if (linked) {
          showError("Une action vise ce symptôme. Modifiez d’abord le symptôme visé par cette action avant de le retirer.", linked);
          return;
        }
      }
      row.remove();
      refreshRows();
    });
    row.append(remove);
    container.append(row);
    return row;
  }

  function appendSymptom(text = "") {
    if (symptoms.children.length >= MAX_SYMPTOMS) return;
    const row = createRow(symptoms, "symptom");
    row.append(
      field("Problème observé *", "textarea", "text", { required: true, maxLength: 1000 }),
      field("Gravité (facultatif)", "input", "severity", { maxLength: 50 }),
    );
    get(row, "text").value = text;
    refreshRows();
    return row;
  }

  function appendAction() {
    if (actions.children.length >= MAX_ACTIONS) return;
    const row = createRow(actions, "action");
    row.append(
      field("Action réalisée *", "textarea", "text", { required: true, maxLength: 1000 }),
      field("Résultat observé après cette action *", "textarea", "result", { required: true, maxLength: 2000 }),
    );
    const grid = createElement("div", "intervention-grid");
    grid.append(
      field("Effet de l’action", "select", "outcome", { options: ACTION_OUTCOMES }),
      field("Symptôme visé", "select", "target"),
    );
    const check = createElement("label", "intervention-check");
    const confirmed = createElement("input");
    confirmed.type = "checkbox";
    confirmed.dataset.field = "confirmed";
    check.append(confirmed, document.createTextNode("C’est cette action qui a résolu le problème"));
    row.append(grid, check);
    confirmed.addEventListener("change", () => {
      if (confirmed.checked) get(row, "outcome").value = "resolved";
    });
    get(row, "outcome").addEventListener("change", () => {
      if (get(row, "outcome").value !== "resolved") confirmed.checked = false;
    });
    refreshRows();
    return row;
  }

  /**
   * Mêmes règles que le backend (intervention_add_schema.py), vérifiées avant
   * l'envoi pour afficher un message clair sur le bon champ. Le backend
   * revérifie tout : ceci n'est qu'un confort.
   */
  function findInvalidField() {
    const value = (name) => form.elements[name].value.trim();
    if (!value("deviceType")) return ["Choisissez le type d’appareil (GAB ou TPE).", form.elements.deviceType];
    if (value("deviceId") && !/^\d+$/.test(value("deviceId"))) {
      return ["L’identifiant de l’appareil doit être un nombre.", form.elements.deviceId];
    }
    for (const [index, row] of [...symptoms.children].entries()) {
      if (!get(row, "text").value) return [`Décrivez le symptôme ${index + 1}.`, get(row, "text")];
    }
    const actionRows = [...actions.children];
    for (const [index, row] of actionRows.entries()) {
      if (!get(row, "text").value) return [`Décrivez l’action ${index + 1}.`, get(row, "text")];
      if (!get(row, "result").value) return [`Indiquez le résultat de l’action ${index + 1}.`, get(row, "result")];
    }
    const solved = actionRows.some((row) => get(row, "confirmed").checked);
    if (value("finalOutcome") === "resolved" && !solved) {
      return ["Intervention résolue : cochez l’action qui a résolu le problème.", get(actionRows.at(-1), "confirmed")];
    }
    if (solved && value("finalOutcome") !== "resolved") {
      return ["Une action a résolu le problème : choisissez « Résolue » comme bilan.", form.elements.finalOutcome];
    }
    if (value("openedAt") && value("closedAt") && value("closedAt") < value("openedAt")) {
      return ["La fin de l’intervention ne peut pas être avant son début.", form.elements.closedAt];
    }
    if (form.elements.diagnosisConfirmed.checked && !value("diagnosis")) {
      return ["Décrivez la cause avant de la marquer comme confirmée.", form.elements.diagnosis];
    }
    return null;
  }

  function readContent() {
    for (const control of form.querySelectorAll("textarea, input:not([type=checkbox])")) {
      control.value = control.value.trim();
    }
    const invalid = findInvalidField();
    if (invalid) {
      showError(...invalid);
      return null;
    }
    const value = (name) => form.elements[name].value.trim();
    const openedAt = value("openedAt") ? new Date(value("openedAt")).toISOString() : null;
    const closedAt = value("closedAt") ? new Date(value("closedAt")).toISOString() : null;
    const symptomRows = [...symptoms.children];
    const actionValues = [...actions.children].map((row) => ({
      text: get(row, "text").value,
      result_description: get(row, "result").value,
      outcome_status: get(row, "outcome").value,
      is_confirmed_solution: get(row, "confirmed").checked,
      targets_symptom_number: get(row, "target").value
        ? symptomRows.findIndex((symptom) => symptom.dataset.key === get(row, "target").value) + 1 : null,
    }));
    return {
      technician_id: target.technicianId,
      conversation_id: target.conversationId,
      device: {
        device_type: value("deviceType") || null,
        model_name: value("modelName") || null,
        serial_number: value("serialNumber") || null,
        device_id: value("deviceId") ? Number(value("deviceId")) : null,
        site_name: value("siteName") || null,
        address: value("deviceAddress") || null,
      },
      ticket_reference: value("ticketReference") || null,
      opened_at: openedAt,
      closed_at: closedAt,
      final_outcome_status: value("finalOutcome"),
      summary_text: value("summary") || null,
      symptoms: symptomRows.map((row) => ({
        text: get(row, "text").value,
        severity: get(row, "severity").value || null,
      })),
      actions: actionValues,
      diagnosis: value("diagnosis")
        ? { description: value("diagnosis"), confirmed: form.elements.diagnosisConfirmed.checked }
        : null,
    };
  }

  addSymptom.addEventListener("click", () => get(appendSymptom(), "text").focus());
  addAction.addEventListener("click", () => get(appendAction(), "text").focus());
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (submitting) event.preventDefault();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!submitting) dialog.close();
    }
  });
  dialog.addEventListener("close", () => opener?.focus());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting || dialog.dataset.state === "success") return;
    showError("");
    const content = readContent();
    if (!content) return;
    submitting = true;
    dialog.dataset.state = "submitting";
    fields.querySelectorAll("input, textarea, select, button").forEach((control) => { control.disabled = true; });
    submit.disabled = true;
    cancel.disabled = true;
    submit.textContent = "Envoi en cours…";
    try {
      const result = await submitInterventionAdd(content);
      dialog.dataset.state = "success";
      fields.hidden = true;
      submit.hidden = true;
      dialog.querySelector("[data-intervention-note]").hidden = true;
      success.replaceChildren(
        createIcon("check"),
        createElement("strong", "", `Proposition n° ${result.id} envoyée`),
        createElement("p", "", "En attente de validation par un administrateur. Elle n’est pas encore ajoutée à l’historique des interventions."),
      );
      success.hidden = false;
      cancel.textContent = "Fermer";
      success.focus();
      onSubmitted({ ...result, conversationId: target.conversationId });
    } catch (error) {
      dialog.dataset.state = "ready";
      showError(error.detail || getFriendlyErrorMessage(error));
    } finally {
      submitting = false;
      fields.querySelectorAll("input, textarea, select, button").forEach((control) => { control.disabled = false; });
      refreshRows();
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "Envoyer pour validation";
    }
  });

  return {
    open({ technicianId, conversationId = null, problemText = "", deviceType }) {
      if (submitting || dialog.open) return;
      opener = document.activeElement;
      target = { technicianId, conversationId };
      form.reset();
      form.elements.deviceType.value = deviceType;
      symptoms.replaceChildren();
      actions.replaceChildren();
      appendSymptom(problemText || "");
      appendAction();
      fields.hidden = false;
      success.hidden = true;
      submit.hidden = false;
      cancel.textContent = "Annuler";
      dialog.querySelector("[data-intervention-note]").hidden = false;
      dialog.dataset.state = "ready";
      showError("");
      dialog.showModal();
      form.elements.deviceType.focus();
    },
  };
}
