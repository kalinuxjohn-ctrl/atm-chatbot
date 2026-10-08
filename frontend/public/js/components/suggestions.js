/**
 * Menus déroulants de suggestions, affichés juste au-dessus de la zone de saisie.
 * Deux menus, deux comportements :
 *
 *   [ Pannes fréquentes      ▾ ]  PROBLÈME FRÉQUENT -> envoyé au backend comme
 *                                 un message tapé par le technicien.
 *                                 Pour en ajouter : compléter SUGGESTIONS_BY_DEVICE.
 *
 *   [ Codes d'erreur connus  ▾ ]  CODE D'ERREUR CONNU -> réponse enregistrée
 *                                 côté frontend, AUCUN appel au backend.
 *                                 Pour en ajouter : public/data/error-codes/README.md
 */

import { createElement } from "../utils/dom.js";

export const SUGGESTIONS_BY_DEVICE = Object.freeze({
  gab: [
    "Le GAB a avalé la carte du client",
    "Écran noir au démarrage du GAB",
    "Billets bloqués dans le distributeur",
    "L’imprimante de tickets ne fonctionne plus",
    "Le GAB est hors service",
  ],
  tpe: [
    "Le TPE ne lit pas la carte",
    "Paiement sans contact refusé",
    "L’imprimante du TPE n’imprime plus",
    "Le TPE ne se connecte pas au réseau",
    "L’écran du TPE est figé",
  ],
});

/**
 * Crée les deux menus : pannes fréquentes, puis codes d'erreur connus.
 * Le menu des codes n'apparaît que s'il y a au moins un code pour cet équipement.
 * @param {{
 *   deviceType: string,
 *   onPick: (text: string) => void,                                  choix d'une panne fréquente
 *   errorCodes?: import("../services/knownErrorCodesService.js").KnownErrorCode[],  déjà filtrés pour deviceType
 *   onPickErrorCode?: (errorCode: object) => void,                   choix d'un code d'erreur
 * }} options
 * @returns {HTMLDivElement}
 */
export function createSuggestionMenus({ deviceType, onPick, errorCodes = [], onPickErrorCode = () => {} }) {
  const container = createElement("div", "suggestion-menus");

  const frequentProblems = SUGGESTIONS_BY_DEVICE[deviceType] || SUGGESTIONS_BY_DEVICE.gab;
  container.append(
    createMenu({
      placeholder: "Pannes fréquentes…",
      ariaLabel: "Choisir une panne fréquente",
      options: frequentProblems.map((text) => ({ label: text })),
      onChoose: (index) => onPick(frequentProblems[index]),
    }),
  );

  if (errorCodes.length > 0) {
    container.append(
      createMenu({
        placeholder: "Codes d’erreur connus…",
        ariaLabel: "Choisir un code d'erreur connu",
        options: errorCodes.map(({ code, label }) => ({ label: `${code} — ${label}` })),
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
