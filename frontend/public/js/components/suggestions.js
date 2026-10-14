/**
 * Menus déroulants de suggestions, affichés juste au-dessus de la zone de saisie.
 * Les deux menus ont le même comportement : leurs entrées ET leurs réponses
 * viennent du backend, qui les lit en base SANS IA (ni LLM, ni embedding).
 *
 *   [ Pannes fréquentes      ▾ ]  GET /api/usual_problem?device_type=...
 *   [ Codes d'erreur connus  ▾ ]  GET /api/error_code?device_type=...
 *
 * Pour en ajouter : remplir les tables usual_problem / error_code (colonnes
 * device_type et reply), voir la migration 0011.
 */

import { createElement } from "../utils/dom.js";

/**
 * Crée les deux menus : pannes fréquentes, puis codes d'erreur connus.
 * Un menu n'apparaît que s'il a au moins une entrée pour cet équipement.
 * @param {{
 *   usualProblems?: import("../services/api/usualProblemApi.js").UsualProblem[],
 *   onPickUsualProblem?: (usualProblem: object) => void,
 *   errorCodes?: import("../services/api/errorCodeApi.js").KnownErrorCode[],
 *   onPickErrorCode?: (errorCode: object) => void,
 * }} options
 * @returns {HTMLDivElement}
 */
export function createSuggestionMenus({
  usualProblems = [],
  onPickUsualProblem = () => {},
  errorCodes = [],
  onPickErrorCode = () => {},
}) {
  const container = createElement("div", "suggestion-menus");

  if (usualProblems.length > 0) {
    container.append(
      createMenu({
        placeholder: "Pannes fréquentes…",
        ariaLabel: "Choisir une panne fréquente",
        options: usualProblems.map(({ label }) => ({ label })),
        onChoose: (index) => onPickUsualProblem(usualProblems[index]),
      }),
    );
  }

  if (errorCodes.length > 0) {
    container.append(
      createMenu({
        placeholder: "Codes d’erreur connus…",
        ariaLabel: "Choisir un code d'erreur connu",
        options: errorCodes.map(({ code, label }) => ({ label: label ? `${code} — ${label}` : code })),
        onChoose: (index) => onPickErrorCode(errorCodes[index]),
        className: "error-code-menu",
      }),
    );
  }
  return container;
}

/**
 * Un menu déroulant natif (accessible au clavier et sur mobile). Il revient sur
 * son texte d'invite après chaque choix, pour pouvoir rechoisir la même entrée.
 */
function createMenu({ placeholder, ariaLabel, options, onChoose, className = "" }) {
  const select = createElement("select", `suggestion-menu ${className}`.trim());
  select.setAttribute("aria-label", ariaLabel);

  const placeholderOption = createElement("option", "", placeholder);
  placeholderOption.value = "";
  placeholderOption.selected = true;
  placeholderOption.disabled = true;
  select.append(placeholderOption);

  // La valeur de chaque option est sa position dans la liste d'origine.
  options.forEach(({ label }, index) => {
    const option = createElement("option", "", label);
    option.value = String(index);
    select.append(option);
  });

  select.addEventListener("change", () => {
    const chosenIndex = Number(select.value);
    select.value = "";
    onChoose(chosenIndex);
  });
  return select;
}
