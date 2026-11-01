/**
 * Création d'éléments du DOM SANS innerHTML.
 *
 * Règle anti-XSS de toute la main app : un texte saisi par un utilisateur
 * (message, titre de point, nom) est toujours inséré avec textContent. Le
 * navigateur l'affiche comme des caractères, jamais comme du HTML : « <script> »
 * reste visible tel quel, et les emojis s'affichent normalement.
 */

export function createElementWithText(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
}

export function createButton(label, { className = "button", type = "button", onClick = null } = {}) {
  const button = createElementWithText("button", className, label);
  button.type = type;
  if (onClick) {
    button.addEventListener("click", onClick);
  }
  return button;
}

/** Date lisible en français : « aujourd'hui 14:05 » ou « 03/11/2026 14:05 ». */
export function formatDateTime(isoDateText) {
  const date = new Date(isoDateText);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? `aujourd'hui ${time}` : `${date.toLocaleDateString("fr-FR")} ${time}`;
}
