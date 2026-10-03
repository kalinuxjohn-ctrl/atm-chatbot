/**
 * Sélecteur du type d'équipement (GAB / TPE).
 *
 * Remplace le <select> natif par un bouton large (icône, nom, description,
 * chevron) qui ouvre une liste d'options. Accessible au clavier :
 * flèches haut/bas, Entrée/Espace pour choisir, Échap pour fermer.
 *
 * Les valeurs restent celles de l'API : "gab" | "tpe".
 */

import { createElement } from "../utils/dom.js";
import { createIcon } from "./icons.js";

export const DEVICE_OPTIONS = Object.freeze([
  { value: "gab", name: "GAB", description: "Distributeur automatique de billets", icon: "atm" },
  { value: "tpe", name: "TPE", description: "Terminal de paiement électronique", icon: "terminal" },
]);

/**
 * @param {{ container: HTMLElement, onChange: (value: string) => void }} options
 */
export function createDevicePicker({ container, onChange }) {
  let currentValue = DEVICE_OPTIONS[0].value;
  let disabled = false;

  const trigger = createElement("button", "device-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const triggerIcon = createElement("span", "device-trigger-icon");
  const triggerText = createElement("span", "device-trigger-text");
  const triggerCaption = createElement("small", "", "Équipement");
  const triggerName = createElement("strong");
  triggerText.append(triggerCaption, triggerName);
  trigger.append(triggerIcon, triggerText, createIcon("chevron-down", "icon device-trigger-chevron"));

  const listbox = createElement("ul", "device-menu");
  listbox.id = `device-menu-${Math.random().toString(36).slice(2, 8)}`;
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-label", "Type d’équipement");
  listbox.tabIndex = -1;
  listbox.hidden = true;
  trigger.setAttribute("aria-controls", listbox.id);

  const optionElements = DEVICE_OPTIONS.map((option) => {
    const item = createElement("li", "device-option");
    item.id = `${listbox.id}-${option.value}`;
    item.setAttribute("role", "option");
    item.dataset.value = option.value;
    const icon = createElement("span", "device-option-icon");
    icon.append(createIcon(option.icon));
    const text = createElement("span", "device-option-text");
    text.append(createElement("strong", "", option.name), createElement("small", "", option.description));
    item.append(icon, text, createIcon("check", "icon device-option-check"));
    item.addEventListener("click", () => select(option.value, { notify: true, close: true }));
    listbox.append(item);
    return item;
  });

  container.replaceChildren(trigger, listbox);

  function render() {
    const option = DEVICE_OPTIONS.find((candidate) => candidate.value === currentValue);
    triggerIcon.replaceChildren(createIcon(option.icon));
    triggerName.textContent = option.name;
    trigger.setAttribute("aria-label", `Équipement : ${option.name}, ${option.description}. Changer`);
    trigger.title = option.description;
    optionElements.forEach((item) => item.setAttribute("aria-selected", String(item.dataset.value === currentValue)));
    container.dataset.device = currentValue;
  }

  function select(value, { notify = false, close = false } = {}) {
    if (!DEVICE_OPTIONS.some((option) => option.value === value)) return;
    const changed = value !== currentValue;
    currentValue = value;
    render();
    if (close) closeMenu({ focusTrigger: true });
    if (notify && changed) onChange(value);
  }

  function setActiveOption(item) {
    optionElements.forEach((candidate) => candidate.classList.toggle("is-active", candidate === item));
    listbox.setAttribute("aria-activedescendant", item.id);
  }

  function openMenu() {
    if (disabled) return;
    listbox.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    container.classList.add("is-open");
    setActiveOption(optionElements.find((item) => item.dataset.value === currentValue));
    listbox.focus();
    document.addEventListener("pointerdown", handleOutsidePointer);
  }

  function closeMenu({ focusTrigger = false } = {}) {
    if (listbox.hidden) return;
    listbox.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    container.classList.remove("is-open");
    document.removeEventListener("pointerdown", handleOutsidePointer);
    if (focusTrigger) trigger.focus();
  }

  function handleOutsidePointer(event) {
    if (!container.contains(event.target)) closeMenu();
  }

  trigger.addEventListener("click", () => (listbox.hidden ? openMenu() : closeMenu()));
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu();
    }
  });

  listbox.addEventListener("keydown", (event) => {
    const activeIndex = optionElements.findIndex((item) => item.classList.contains("is-active"));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveOption(optionElements[(activeIndex + step + optionElements.length) % optionElements.length]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(optionElements[activeIndex].dataset.value, { notify: true, close: true });
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      closeMenu({ focusTrigger: event.key === "Escape" });
    }
  });

  render();

  return {
    get value() {
      return currentValue;
    },
    /** Change la valeur affichée sans déclencher onChange (ex. restauration). */
    setValue(value) {
      select(value);
    },
    setDisabled(isDisabled) {
      disabled = isDisabled;
      trigger.disabled = isDisabled;
      if (isDisabled) closeMenu();
    },
  };
}
