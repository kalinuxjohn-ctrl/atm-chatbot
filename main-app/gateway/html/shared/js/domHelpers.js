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

/**
 * Pastille ronde avec les initiales du nom (« bob_terrain » -> « BT »).
 * Sa couleur est tirée du nom : la même personne garde la même couleur partout.
 */
export function createAvatar(username, { sizeClassName = "", isOnline = null } = {}) {
  const safeUsername = username || "?";
  const nameParts = safeUsername.split(/[\s_.-]+/).filter(Boolean);
  const initials = (nameParts.length > 1 ? nameParts[0][0] + nameParts[1][0] : safeUsername.slice(0, 2)).toUpperCase();
  const colorIndex = [...safeUsername].reduce((sum, character) => sum + character.codePointAt(0), 0) % 6;
  const avatar = createElementWithText("span", `avatar avatar-color-${colorIndex} ${sizeClassName}`.trim(), initials);
  avatar.setAttribute("aria-hidden", "true");
  if (isOnline !== null) {
    avatar.append(createElementWithText("span", isOnline ? "avatar-presence avatar-presence-online" : "avatar-presence"));
  }
  return avatar;
}

/** Jour d'un message pour les séparateurs : « Aujourd'hui », « Hier » ou « lundi 3 novembre ». */
export function formatDayLabel(isoDateText) {
  const date = new Date(isoDateText);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return "Aujourd'hui";
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return "Hier";
  }
  const label = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Heure seule, « 14:05 ». */
export function formatTime(isoDateText) {
  return new Date(isoDateText).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Date lisible en français : « aujourd'hui 14:05 » ou « 03/11/2026 14:05 ». */
export function formatDateTime(isoDateText) {
  const date = new Date(isoDateText);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? `aujourd'hui ${time}` : `${date.toLocaleDateString("fr-FR")} ${time}`;
}
