/**
 * Icônes SVG de l'interface (style trait, 24×24), dessinées dans le code.
 *
 * Dans le HTML : <span data-icon="mic"></span>, puis hydrateIcons(document).
 * Dans le JS   : createIcon("mic").
 * Pour AJOUTER une icône : ajouter son tracé dans ICON_PATHS.
 */

const ICON_PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  chat: '<path d="M4 5.5h16v10H9.5L5 19.5v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  diagnostic: '<path d="M9 4h6v3H9z"/><path d="M15 5.5h3.5v15h-13v-15H9"/><path d="M8.5 13h2l1.5-3 2 6 1.5-3h1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  voice: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  collapse: '<path d="M4 4h16v16H4z"/><path d="M9 4v16"/><path d="M15.5 9.5 13 12l2.5 2.5"/>',
  expand: '<path d="M4 4h16v16H4z"/><path d="M9 4v16"/><path d="M13 9.5l2.5 2.5-2.5 2.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/>',
  "mic-off":
    '<path d="M15 10V6a3 3 0 0 0-5.7-1.3"/><path d="M9 9v2a3 3 0 0 0 4.6 2.5"/><path d="M5.5 11a6.5 6.5 0 0 0 10.6 5"/><path d="M18.5 11a6.4 6.4 0 0 1-.4 2.2"/><path d="M12 17.5V21M8.5 21h7"/><path d="M3 3l18 18"/>',
  send: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  panel: '<path d="M4 4h16v16H4z"/><path d="M15 4v16"/>',
  atm: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M7 6.5h10v5H7z"/><path d="M8 15h8"/><path d="M9.5 18h5"/>',
  terminal: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M9 5.5h6v4H9z"/><path d="M9 13h.01M12 13h.01M15 13h.01M9 16h.01M12 16h.01M15 16h.01M9 19h6"/>',
  "chevron-down": '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  alert: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M7 14.5h10"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
};

/** @returns {SVGSVGElement} icône décorative (aria-hidden) */
export function createIcon(name, className = "icon") {
  const template = document.createElement("template");
  template.innerHTML = `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ""}</svg>`;
  return template.content.firstElementChild;
}

/** Remplace chaque <span data-icon="nom"> par son icône. */
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((slot) => {
    if (slot.firstElementChild) return;
    slot.append(createIcon(slot.dataset.icon));
  });
}

/** Change l'icône d'un emplacement [data-icon] déjà hydraté. */
export function setIcon(slot, name) {
  slot.dataset.icon = name;
  slot.replaceChildren(createIcon(name));
}
