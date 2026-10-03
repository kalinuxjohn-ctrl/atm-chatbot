/**
 * Suggestions de problèmes fréquents ("bulles").
 *
 * Elles sont affichées à deux endroits : sous la zone de saisie et dans le
 * message d'accueil de la conversation. Un clic envoie le texte comme un
 * message du technicien, par le flux normal du chat.
 *
 * Ce ne sont PAS des données du backend : uniquement des raccourcis de saisie.
 * Pour en AJOUTER : compléter SUGGESTIONS_BY_DEVICE.
 */

import { createElement, prefersReducedMotion } from "../utils/dom.js";
import { createIcon } from "./icons.js";

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

const FLIGHT_DURATION_MS = 520;

/**
 * Crée la liste de bulles.
 * @param {{ deviceType: string, onPick: (text: string, chip: HTMLElement) => void, className?: string }} options
 * @returns {HTMLUListElement}
 */
export function createSuggestionList({ deviceType, onPick, className = "" }) {
  const list = createElement("ul", `suggestion-list ${className}`.trim());
  list.setAttribute("aria-label", "Suggestions de problèmes fréquents");
  (SUGGESTIONS_BY_DEVICE[deviceType] || SUGGESTIONS_BY_DEVICE.gab).forEach((text) => {
    const item = createElement("li");
    const chip = createElement("button", "suggestion-chip");
    chip.type = "button";
    chip.append(createIcon("sparkle", "icon suggestion-chip-icon"), createElement("span", "", text));
    chip.addEventListener("click", () => onPick(text, chip));
    item.append(chip);
    list.append(item);
  });
  return list;
}

/**
 * Animation : une copie de la bulle monte vers le bas de la conversation, à
 * l'endroit où le message du technicien va apparaître.
 * @returns {Promise<void>} résolue quand la bulle est arrivée
 */
export async function flySuggestionToConversation(chip, conversationElement) {
  if (prefersReducedMotion() || typeof chip.animate !== "function") return;

  const from = chip.getBoundingClientRect();
  const to = conversationElement.getBoundingClientRect();
  const ghost = chip.cloneNode(true);
  ghost.classList.add("suggestion-ghost");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    top: `${from.top}px`,
    left: `${from.left}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  document.body.append(ghost);
  chip.classList.add("is-launched");

  // Arrivée : aligné à droite (côté messages du technicien), en bas du fil.
  const deltaX = to.right - 28 - from.right;
  const deltaY = Math.min(0, to.bottom - 34 - from.bottom);

  try {
    await ghost.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(1.05)`, opacity: 1, offset: 0.8 },
        { transform: `translate(${deltaX}px, ${deltaY - 8}px) scale(1.05)`, opacity: 0 },
      ],
      { duration: FLIGHT_DURATION_MS, easing: "cubic-bezier(0.22, 0.8, 0.25, 1)" },
    ).finished;
  } catch {
    /* animation interrompue : on continue sans elle */
  } finally {
    ghost.remove();
    chip.classList.remove("is-launched");
  }
}
