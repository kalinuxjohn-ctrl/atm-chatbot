/**
 * Menus déroulants de suggestions, affichés dans la zone de saisie.
 * Les deux menus ont le même comportement : leurs entrées ET leurs réponses
 * viennent du backend, qui les lit en base SANS IA (ni LLM, ni embedding).
 *
 *   [ Pannes fréquentes      ▾ ]  GET /api/usual_problem?device_type=...
 *   [ Codes d'erreur connus  ▾ ]  GET /api/error_code?device_type=...
 *
 * Chaque menu est une pastille qui ouvre, au-dessus de la saisie, un panneau
 * en verre (titre, filtre, liste). Accessible au clavier : flèches pour se
 * déplacer, Entrée pour choisir, Échap pour fermer.
 *
 * Pour en ajouter : remplir les tables usual_problem / error_code (colonnes
 * device_type et reply), voir la migration 0011.
 */

import { createElement } from "../utils/dom.js";
import { createIcon } from "./icons.js";

// Au-delà de ce nombre d'entrées, un champ de filtre apparaît en tête de liste.
const FILTER_THRESHOLD = 6;

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
        title: "Pannes fréquentes",
        ariaLabel: "Choisir une panne fréquente",
        icon: "wrench",
        options: usualProblems.map(({ label }) => ({ label })),
        onChoose: (index) => onPickUsualProblem(usualProblems[index]),
      }),
    );
  }

  if (errorCodes.length > 0) {
    container.append(
      createMenu({
        title: "Codes d’erreur connus",
        ariaLabel: "Choisir un code d'erreur connu",
        icon: "alert",
        options: errorCodes.map(({ code, label }) => ({ badge: code, label: label || code })),
        onChoose: (index) => onPickErrorCode(errorCodes[index]),
        className: "error-code-menu",
      }),
    );
  }
  return container;
}

/**
 * Un menu : pastille déclencheur + panneau de choix.
 * @param {{ title: string, ariaLabel: string, icon: string,
 *   options: { label: string, badge?: string }[], onChoose: (index: number) => void, className?: string }} config
 */
function createMenu({ title, ariaLabel, icon, options, onChoose, className = "" }) {
  const menuId = `suggestion-menu-${Math.random().toString(36).slice(2, 8)}`;
  const root = createElement("div", `suggestion-dropdown ${className}`.trim());

  /* ----- Pastille ----- */
  const trigger = createElement("button", "suggestion-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);
  trigger.setAttribute("aria-label", ariaLabel);
  const triggerIcon = createElement("span", "suggestion-trigger-icon");
  triggerIcon.append(createIcon(icon));
  trigger.append(
    triggerIcon,
    createElement("span", "suggestion-trigger-label", title),
    createIcon("chevron-down", "icon suggestion-trigger-chevron"),
  );

  /* ----- Panneau ----- */
  const popover = createElement("div", "suggestion-popover");
  popover.hidden = true;

  const header = createElement("div", "suggestion-popover-header");
  const headerIcon = createElement("span", "suggestion-popover-icon");
  headerIcon.append(createIcon(icon));
  const headerText = createElement("span", "suggestion-popover-title");
  headerText.append(
    createElement("strong", "", title),
    createElement("small", "", `${options.length} ${options.length > 1 ? "réponses enregistrées" : "réponse enregistrée"}`),
  );
  header.append(headerIcon, headerText);
  popover.append(header);

  let filterInput = null;
  if (options.length > FILTER_THRESHOLD) {
    const filterLabel = createElement("label", "suggestion-filter");
    filterInput = createElement("input");
    filterInput.type = "search";
    filterInput.placeholder = "Filtrer…";
    filterInput.setAttribute("aria-label", `Filtrer : ${title}`);
    filterInput.setAttribute("aria-controls", menuId);
    filterLabel.append(createIcon("search"), filterInput);
    popover.append(filterLabel);
  }

  const listbox = createElement("ul", "suggestion-list");
  listbox.id = menuId;
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-label", title);
  listbox.tabIndex = -1;

  const optionElements = options.map(({ label, badge }, index) => {
    const item = createElement("li", "suggestion-option");
    item.id = `${menuId}-${index}`;
    item.setAttribute("role", "option");
    item.style.setProperty("--index", String(Math.min(index, 10)));
    const marker = createElement("span", badge ? "suggestion-option-badge" : "suggestion-option-icon");
    if (badge) marker.textContent = badge;
    else marker.append(createIcon("chat"));
    item.append(marker, createElement("span", "suggestion-option-label", label));
    item.addEventListener("click", () => choose(index));
    item.addEventListener("pointermove", () => setActive(item));
    listbox.append(item);
    return item;
  });

  const emptyMessage = createElement("p", "suggestion-empty", "Aucun résultat");
  emptyMessage.hidden = true;
  popover.append(listbox, emptyMessage);
  root.append(trigger, popover);

  /* ----- Comportement ----- */
  const visibleOptions = () => optionElements.filter((item) => !item.hidden);

  function setActive(item) {
    optionElements.forEach((candidate) => candidate.classList.toggle("is-active", candidate === item));
    if (item) {
      listbox.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView({ block: "nearest" });
    } else {
      listbox.removeAttribute("aria-activedescendant");
    }
  }

  function moveActive(step) {
    const items = visibleOptions();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.classList.contains("is-active"));
    setActive(items[(current + step + items.length) % items.length]);
  }

  function applyFilter() {
    const query = filterInput.value.trim().toLocaleLowerCase("fr");
    optionElements.forEach((item) => {
      item.hidden = Boolean(query) && !item.textContent.toLocaleLowerCase("fr").includes(query);
    });
    const items = visibleOptions();
    emptyMessage.hidden = items.length > 0;
    setActive(items[0] || null);
  }

  function open() {
    if (trigger.disabled || !popover.hidden) return;
    popover.hidden = false;
    root.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    if (filterInput) {
      filterInput.value = "";
      applyFilter();
      filterInput.focus();
    } else {
      setActive(optionElements[0]);
      listbox.focus();
    }
    document.addEventListener("pointerdown", handleOutsidePointer);
  }

  function close({ focusTrigger = false } = {}) {
    if (popover.hidden) return;
    popover.hidden = true;
    root.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", handleOutsidePointer);
    if (focusTrigger) trigger.focus();
  }

  function choose(index) {
    if (trigger.disabled) return;
    close({ focusTrigger: true });
    onChoose(index);
  }

  function handleOutsidePointer(event) {
    if (!root.contains(event.target)) close();
  }

  function handleKeys(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || (event.key === " " && event.currentTarget === listbox)) {
      event.preventDefault();
      const active = optionElements.find((item) => item.classList.contains("is-active") && !item.hidden);
      if (active) choose(optionElements.indexOf(active));
    } else if (event.key === "Escape") {
      event.preventDefault();
      close({ focusTrigger: true });
    } else if (event.key === "Tab") {
      close();
    }
  }

  trigger.addEventListener("click", () => (popover.hidden ? open() : close()));
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
    }
  });
  listbox.addEventListener("keydown", handleKeys);
  filterInput?.addEventListener("keydown", handleKeys);
  filterInput?.addEventListener("input", applyFilter);

  return root;
}
