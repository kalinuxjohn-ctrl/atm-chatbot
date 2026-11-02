/**
 * Icônes de l'interface, dessinées en SVG (traits de 2 px, grille 24 × 24).
 *
 * Construites avec createElementNS à partir des formes ci-dessous : pas de
 * fichier image à charger, pas d'innerHTML, rien qui gêne la CSP. Elles
 * prennent la couleur du texte (stroke: currentColor dans base.css).
 *
 *   JavaScript : bouton.prepend(createIcon("phone"))
 *   HTML       : <span data-icon="map"></span>  (remplacé par replaceIconPlaceholders())
 */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Chaque icône = liste de formes [balise, attributs]. */
const ICON_SHAPES = {
  home: [
    ["path", { d: "M3 10.5 12 3l9 7.5" }],
    ["path", { d: "M5 9.5V21h5v-6h4v6h5V9.5" }],
  ],
  map: [
    ["path", { d: "M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" }],
    ["path", { d: "M9 4v13.5M15 6.5V20" }],
  ],
  message: [["path", { d: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" }]],
  phone: [
    [
      "path",
      {
        d: "M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4z",
      },
    ],
  ],
  phoneOff: [
    ["path", { d: "M10.7 13.3a11 11 0 0 0 3.4 2.7l1.4-2.3 4.5 1.8V19a2 2 0 0 1-2.2 2 17 17 0 0 1-8.1-3.3" }],
    ["path", { d: "M5.6 13.9A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4h3.5l1.8 4.5-2.3 1.4" }],
    ["path", { d: "M3 21 21 3" }],
  ],
  phoneIncoming: [
    ["path", { d: "M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4z" }],
    ["path", { d: "M21 3l-6 6M15 4v5h5" }],
  ],
  phoneOutgoing: [
    ["path", { d: "M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4z" }],
    ["path", { d: "M15 9l6-6M16 3h5v5" }],
  ],
  users: [
    ["circle", { cx: "9", cy: "8", r: "3.5" }],
    ["path", { d: "M2.5 20a6.5 6.5 0 0 1 13 0" }],
    ["path", { d: "M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" }],
  ],
  logout: [
    ["path", { d: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" }],
    ["path", { d: "M10 16l-4-4 4-4M6 12h10" }],
  ],
  sun: [
    ["circle", { cx: "12", cy: "12", r: "4" }],
    ["path", { d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }],
  ],
  moon: [["path", { d: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" }]],
  locate: [
    ["circle", { cx: "12", cy: "12", r: "7" }],
    ["circle", { cx: "12", cy: "12", r: "2.5" }],
    ["path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" }],
  ],
  radar: [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["circle", { cx: "12", cy: "12", r: "5" }],
    ["path", { d: "M12 12l5.5-5.5" }],
  ],
  pin: [
    ["path", { d: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" }],
    ["circle", { cx: "12", cy: "9.5", r: "2.5" }],
  ],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  close: [["path", { d: "M6 6l12 12M18 6 6 18" }]],
  image: [
    ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2.5" }],
    ["circle", { cx: "9", cy: "9.5", r: "1.8" }],
    ["path", { d: "M21 15.5l-5-5L5 20" }],
  ],
  microphone: [
    ["rect", { x: "9", y: "3", width: "6", height: "11", rx: "3" }],
    ["path", { d: "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" }],
  ],
  microphoneOff: [
    ["path", { d: "M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3" }],
    ["path", { d: "M18.5 11a6.5 6.5 0 0 1-.9 3.3M5.5 11a6.5 6.5 0 0 0 10.3 5.3M12 17.5V21" }],
    ["path", { d: "M3 3l18 18" }],
  ],
  send: [
    ["path", { d: "M21 3 10.5 13.5" }],
    ["path", { d: "M21 3l-6.5 18-4-7.5L3 9.5z" }],
  ],
  arrowLeft: [["path", { d: "M19 12H5M11 18l-6-6 6-6" }]],
  search: [
    ["circle", { cx: "11", cy: "11", r: "6.5" }],
    ["path", { d: "M20 20l-4.4-4.4" }],
  ],
  filter: [["path", { d: "M3 5h18l-7 8.5V20l-4-2v-4.5z" }]],
  edit: [
    ["path", { d: "M4 20h4L19 9l-4-4L4 16z" }],
    ["path", { d: "M13.5 6.5l4 4" }],
  ],
  trash: [
    ["path", { d: "M4 7h16M10 11v6M14 11v6" }],
    ["path", { d: "M6 7l1 13h10l1-13M9 7V4h6v3" }],
  ],
  shield: [["path", { d: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" }]],
  wrench: [
    [
      "path",
      {
        d: "M14.5 5.5a4 4 0 0 0 5 5L21 9a5.5 5.5 0 0 1-7.4 6.9L7 22.5 1.5 17l6.6-6.6A5.5 5.5 0 0 1 15 3z",
      },
    ],
  ],
  chevronRight: [["path", { d: "M9 6l6 6-6 6" }]],
  creditCard: [
    ["rect", { x: "2.5", y: "5", width: "19", height: "14", rx: "2.5" }],
    ["path", { d: "M2.5 10h19M6.5 15h4" }],
  ],
  store: [
    ["path", { d: "M4 10v10h16V10" }],
    ["path", { d: "M3 4h18l-1.5 6h-15z" }],
    ["path", { d: "M10 20v-5h4v5" }],
  ],
  package: [
    ["path", { d: "M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z" }],
    ["path", { d: "M3.5 7.5 12 12l8.5-4.5M12 12v9" }],
  ],
  alert: [
    ["path", { d: "M12 3.5 2.5 20h19z" }],
    ["path", { d: "M12 10v4.5M12 17.5v.01" }],
  ],
  dot: [["circle", { cx: "12", cy: "12", r: "3.5" }]],
  key: [
    ["circle", { cx: "8", cy: "15", r: "4" }],
    ["path", { d: "M11 12l9-9M17 6l3 3M15 8l2 2" }],
  ],
};

/** <svg> de l'icône `iconName`, décorative (aria-hidden) : le texte du bouton ou son aria-label la décrit. */
export function createIcon(iconName, className = "icon") {
  const svgElement = document.createElementNS(SVG_NAMESPACE, "svg");
  svgElement.setAttribute("viewBox", "0 0 24 24");
  svgElement.setAttribute("aria-hidden", "true");
  svgElement.setAttribute("focusable", "false");
  svgElement.setAttribute("class", className);
  for (const [tagName, attributes] of ICON_SHAPES[iconName] ?? []) {
    const shapeElement = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const [attributeName, attributeValue] of Object.entries(attributes)) {
      shapeElement.setAttribute(attributeName, attributeValue);
    }
    svgElement.append(shapeElement);
  }
  return svgElement;
}

/** Remplace chaque <span data-icon="nom"> du document (ou de `rootElement`) par son icône. */
export function replaceIconPlaceholders(rootElement = document) {
  for (const placeholder of rootElement.querySelectorAll("[data-icon]")) {
    placeholder.replaceWith(createIcon(placeholder.dataset.icon, placeholder.className || "icon"));
  }
}
