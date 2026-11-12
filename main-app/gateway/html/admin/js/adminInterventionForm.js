import { createElementWithText } from "/shared/js/domHelpers.js";
import { createIcon } from "/shared/js/icons.js";
import { interventionAddApi } from "./atmChatbotAdminApi.js";

const ACTION_OUTCOMES = [
  ["resolved", "A réglé le problème"], ["partial", "Amélioration partielle"],
  ["no_effect", "Sans effet"], ["made_worse", "A aggravé"], ["unknown", "Effet inconnu"],
];

export function connectAdminInterventionForm(section, onCreated) {
  const form = section.querySelector("[data-admin-intervention-form]");
  const toggle = section.querySelector("[data-intervention-create-toggle]");
  const errorLine = form.querySelector("[data-admin-intervention-error]");
  const successLine = section.querySelector("[data-admin-intervention-success]");
  const symptomList = form.querySelector("[data-admin-symptoms]");
  const actionList = form.querySelector("[data-admin-actions]");
  const addSymptom = form.querySelector("[data-admin-add-symptom]");
  const addAction = form.querySelector("[data-admin-add-action]");
  let nextSymptomId = 0;
  let busy = false;

  function showError(message) {
    errorLine.textContent = message;
    errorLine.hidden = !message;
  }

  function field(label, control) {
    const wrapper = createElementWithText("label", "form-field", label);
    wrapper.append(control);
    return wrapper;
  }

  function textarea(maxLength) {
    const input = document.createElement("textarea");
    input.required = true;
    input.maxLength = maxLength;
    input.rows = 2;
    return input;
  }

  function select(options) {
    const input = document.createElement("select");
    for (const [value, label] of options) {
      const option = createElementWithText("option", "", label);
      option.value = value;
      input.append(option);
    }
    return input;
  }

  function refreshRows() {
    const symptoms = [...symptomList.children];
    const actions = [...actionList.children];
    for (const [index, row] of symptoms.entries()) {
      row.querySelector("legend").textContent = `Symptôme ${index + 1}`;
      row.querySelector("button").disabled = symptoms.length === 1;
    }
    for (const [index, row] of actions.entries()) {
      row.querySelector("legend").textContent = `Action ${index + 1}`;
      row.querySelector("button").disabled = actions.length === 1;
      const target = row.querySelector("[data-action-target]");
      const previous = target.value;
      target.replaceChildren(...[
        ["", "Tous les symptômes"],
        ...symptoms.map((symptom, number) => [symptom.dataset.symptomId, `Symptôme ${number + 1}`]),
      ].map(([value, label]) => {
        const option = createElementWithText("option", "", label);
        option.value = value;
        return option;
      }));
      if (previous && !symptoms.some((symptom) => symptom.dataset.symptomId === previous)) {
        target.setCustomValidity("Choisissez à nouveau le symptôme visé ou tous les symptômes.");
        showError(`Le symptôme visé par l'action ${index + 1} a été retiré. Vérifiez sa cible avant d'enregistrer.`);
      } else {
        target.value = previous;
      }
    }
    addSymptom.disabled = symptoms.length >= 20;
    addAction.disabled = actions.length >= 30;
  }

  function removeButton(row, label) {
    const button = createElementWithText("button", "button button-secondary", label);
    button.type = "button";
    button.prepend(createIcon("trash"));
    button.addEventListener("click", () => {
      const list = row.parentElement;
      row.remove();
      refreshRows();
      list.querySelector("textarea")?.focus();
    });
    return button;
  }

  function appendSymptom() {
    const row = createElementWithText("fieldset", "admin-intervention-row");
    row.dataset.symptomId = String(++nextSymptomId);
    row.append(document.createElement("legend"), field("Description du symptôme", textarea(1000)),
      removeButton(row, "Retirer ce symptôme"));
    symptomList.append(row);
    refreshRows();
    return row;
  }

  function appendAction() {
    const row = createElementWithText("fieldset", "admin-intervention-row");
    const text = textarea(1000);
    text.dataset.actionText = "";
    const result = textarea(2000);
    result.dataset.actionResult = "";
    const outcome = select(ACTION_OUTCOMES);
    outcome.value = actionList.children.length ? "unknown" : "resolved";
    outcome.dataset.actionOutcome = "";
    const target = select([]);
    target.dataset.actionTarget = "";
    target.addEventListener("change", () => target.setCustomValidity(""));
    const confirmed = document.createElement("input");
    confirmed.type = "checkbox";
    confirmed.dataset.actionConfirmed = "";
    confirmed.checked = actionList.children.length === 0;
    const confirmedLabel = createElementWithText("label", "admin-intervention-checkbox");
    confirmedLabel.append(confirmed, "Cette action est une solution confirmée");
    row.append(document.createElement("legend"), field("Action effectuée", text),
      field("Résultat observé", result), field("Effet de l'action", outcome),
      field("Symptôme visé", target), confirmedLabel, removeButton(row, "Retirer cette action"));
    actionList.append(row);
    refreshRows();
    return row;
  }

  function reset() {
    form.reset();
    symptomList.replaceChildren();
    actionList.replaceChildren();
    showError("");
    appendSymptom();
    appendAction();
  }

  function close() {
    form.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }

  toggle.addEventListener("click", () => {
    if (busy) return;
    if (!form.hidden) {
      close();
      return;
    }
    form.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    successLine.hidden = true;
    form.elements.namedItem("device_type").focus();
  });
  form.querySelector("[data-admin-intervention-cancel]").addEventListener("click", close);
  addSymptom.addEventListener("click", () => appendSymptom().querySelector("textarea").focus());
  addAction.addEventListener("click", () => appendAction().querySelector("textarea").focus());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    showError("");
    const value = (name) => form.elements.namedItem(name).value.trim();
    const symptomRows = [...symptomList.children];
    const actions = [...actionList.children].map((row) => {
      const target = row.querySelector("[data-action-target]").value;
      return {
        text: row.querySelector("[data-action-text]").value.trim(),
        result_description: row.querySelector("[data-action-result]").value.trim(),
        outcome_status: row.querySelector("[data-action-outcome]").value,
        is_confirmed_solution: row.querySelector("[data-action-confirmed]").checked,
        targets_symptom_number: target ? symptomRows.findIndex((symptom) => symptom.dataset.symptomId === target) + 1 : null,
      };
    });
    const hasSolution = actions.some((action) => action.is_confirmed_solution);
    if (actions.some((action) => action.is_confirmed_solution && action.outcome_status !== "resolved")
      || hasSolution !== (value("final_outcome_status") === "resolved")) {
      showError("Une intervention résolue doit avoir au moins une solution confirmée avec l'effet « A réglé le problème ». Pour un autre état final, décochez les solutions confirmées.");
      return;
    }
    const body = {
      device: {
        device_type: value("device_type"),
        model_name: value("model_name") || null,
        site_name: value("site_name") || null,
        serial_number: value("serial_number") || null,
      },
      summary_text: value("summary_text") || null,
      final_outcome_status: value("final_outcome_status"),
      symptoms: symptomRows.map((row) => ({ text: row.querySelector("textarea").value.trim() })),
      actions,
      diagnosis: value("diagnosis") ? {
        description: value("diagnosis"),
        confirmed: form.elements.namedItem("diagnosis_confirmed").checked,
        root_cause_component_text: value("root_cause_component_text") || null,
      } : null,
    };
    if (body.symptoms.some((symptom) => !symptom.text)
      || actions.some((action) => !action.text || !action.result_description)) {
      showError("Renseignez le texte de chaque symptôme, action et résultat ; les espaces seuls ne suffisent pas.");
      return;
    }
    if (!body.diagnosis && (value("root_cause_component_text") || form.elements.namedItem("diagnosis_confirmed").checked)) {
      showError("Renseignez le diagnostic avant d'indiquer sa confirmation ou le composant en cause.");
      return;
    }
    busy = true;
    toggle.disabled = true;
    const controls = [...form.querySelectorAll("input, textarea, select, button")];
    controls.forEach((control) => { control.disabled = true; });
    const submit = form.querySelector("[data-admin-intervention-submit]");
    submit.textContent = "Enregistrement…";
    form.setAttribute("aria-busy", "true");
    let created;
    try {
      created = await interventionAddApi.create(body);
      reset();
      close();
      successLine.textContent = `Intervention n° ${created.created_intervention_id} ajoutée. Origine : admin. Les symptômes sont indexés et les statistiques mises à jour.`;
      successLine.hidden = false;
    } catch (error) {
      console.error("L'ajout direct de l'intervention a échoué.", error);
      showError(error.message);
    } finally {
      busy = false;
      toggle.disabled = false;
      controls.forEach((control) => { control.disabled = false; });
      form.removeAttribute("aria-busy");
      submit.textContent = "Enregistrer dans la base";
      refreshRows();
    }
    if (created) {
      toggle.focus();
      try {
        await onCreated();
      } catch (error) {
        console.error("L'intervention est enregistrée, mais l'actualisation de la liste a échoué.", error);
        successLine.textContent += " La liste n'a pas pu être actualisée : rechargez la page sans ajouter à nouveau l'intervention.";
      }
    }
  });
  reset();
}
