/**
 * Icônes de l'interface : jeu Lucide (https://lucide.dev, licence ISC, voir LICENSE-lucide.txt).
 *
 * FICHIER GÉNÉRÉ par gateway/scripts/generate_lucide_icons.py : ne pas modifier
 * à la main, ajouter l'icône dans le script puis le relancer.
 *
 * Les formes sont dessinées avec createElementNS : pas de fichier image à
 * charger, pas d'innerHTML, rien qui gêne la CSP. Elles prennent la couleur
 * du texte (stroke: currentColor dans base.css).
 *
 *   JavaScript : bouton.prepend(createIcon("phone"))
 *   HTML       : <span data-icon="map"></span>  (remplacé par replaceIconPlaceholders())
 */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Chaque icône = liste de formes [balise, attributs] (format « icon node » de Lucide). */
const ICON_SHAPES = {
  home: [["path", {"d": "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}], ["path", {"d": "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]], // lucide: house
  bot: [["path", {"d": "M12 6V2H8"}], ["path", {"d": "M15 11v2"}], ["path", {"d": "M2 12h2"}], ["path", {"d": "M20 12h2"}], ["path", {"d": "M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"}], ["path", {"d": "M9 11v2"}]], // lucide: bot-message-square
  map: [["path", {"d": "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"}], ["path", {"d": "M15 5.764v15"}], ["path", {"d": "M9 3.236v15"}]], // lucide: map
  message: [["path", {"d": "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]], // lucide: message-circle
  phone: [["path", {"d": "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"}]], // lucide: phone
  shield: [["path", {"d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}], ["path", {"d": "m9 12 2 2 4-4"}]], // lucide: shield-check
  logout: [["path", {"d": "m16 17 5-5-5-5"}], ["path", {"d": "M21 12H9"}], ["path", {"d": "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}]], // lucide: log-out
  sun: [["circle", {"cx": "12", "cy": "12", "r": "4"}], ["path", {"d": "M12 2v2"}], ["path", {"d": "M12 20v2"}], ["path", {"d": "m4.93 4.93 1.41 1.41"}], ["path", {"d": "m17.66 17.66 1.41 1.41"}], ["path", {"d": "M2 12h2"}], ["path", {"d": "M20 12h2"}], ["path", {"d": "m6.34 17.66-1.41 1.41"}], ["path", {"d": "m19.07 4.93-1.41 1.41"}]], // lucide: sun
  moon: [["path", {"d": "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"}]], // lucide: moon
  wrench: [["path", {"d": "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]], // lucide: wrench
  externalLink: [["path", {"d": "M15 3h6v6"}], ["path", {"d": "M10 14 21 3"}], ["path", {"d": "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]], // lucide: external-link
  phoneOff: [["path", {"d": "M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272"}], ["path", {"d": "M22 2 2 22"}], ["path", {"d": "M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473"}]], // lucide: phone-off
  phoneIncoming: [["path", {"d": "M16 2v6h6"}], ["path", {"d": "m22 2-6 6"}], ["path", {"d": "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"}]], // lucide: phone-incoming
  phoneOutgoing: [["path", {"d": "m16 8 6-6"}], ["path", {"d": "M22 8V2h-6"}], ["path", {"d": "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"}]], // lucide: phone-outgoing
  users: [["path", {"d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}], ["path", {"d": "M16 3.128a4 4 0 0 1 0 7.744"}], ["path", {"d": "M22 21v-2a4 4 0 0 0-3-3.87"}], ["circle", {"cx": "9", "cy": "7", "r": "4"}]], // lucide: users
  userPlus: [["path", {"d": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}], ["circle", {"cx": "9", "cy": "7", "r": "4"}], ["line", {"x1": "19", "x2": "19", "y1": "8", "y2": "14"}], ["line", {"x1": "22", "x2": "16", "y1": "11", "y2": "11"}]], // lucide: user-plus
  userCog: [["path", {"d": "M10 15H6a4 4 0 0 0-4 4v2"}], ["path", {"d": "m14.305 16.53.923-.382"}], ["path", {"d": "m15.228 13.852-.923-.383"}], ["path", {"d": "m16.852 12.228-.383-.923"}], ["path", {"d": "m16.852 17.772-.383.924"}], ["path", {"d": "m19.148 12.228.383-.923"}], ["path", {"d": "m19.53 18.696-.382-.924"}], ["path", {"d": "m20.772 13.852.924-.383"}], ["path", {"d": "m20.772 16.148.924.383"}], ["circle", {"cx": "18", "cy": "15", "r": "3"}], ["circle", {"cx": "9", "cy": "7", "r": "4"}]], // lucide: user-cog
  locate: [["line", {"x1": "2", "x2": "5", "y1": "12", "y2": "12"}], ["line", {"x1": "19", "x2": "22", "y1": "12", "y2": "12"}], ["line", {"x1": "12", "x2": "12", "y1": "2", "y2": "5"}], ["line", {"x1": "12", "x2": "12", "y1": "19", "y2": "22"}], ["circle", {"cx": "12", "cy": "12", "r": "7"}], ["circle", {"cx": "12", "cy": "12", "r": "3"}]], // lucide: locate-fixed
  radar: [["path", {"d": "M19.07 4.93A10 10 0 0 0 6.99 3.34"}], ["path", {"d": "M4 6h.01"}], ["path", {"d": "M2.29 9.62A10 10 0 1 0 21.31 8.35"}], ["path", {"d": "M16.24 7.76A6 6 0 1 0 8.23 16.67"}], ["path", {"d": "M12 18h.01"}], ["path", {"d": "M17.99 11.66A6 6 0 0 1 15.77 16.67"}], ["circle", {"cx": "12", "cy": "12", "r": "2"}], ["path", {"d": "m13.41 10.59 5.66-5.66"}]], // lucide: radar
  pin: [["path", {"d": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}], ["circle", {"cx": "12", "cy": "10", "r": "3"}]], // lucide: map-pin
  creditCard: [["rect", {"width": "20", "height": "14", "x": "2", "y": "5", "rx": "2"}], ["line", {"x1": "2", "x2": "22", "y1": "10", "y2": "10"}], ["path", {"d": "M6 14h2"}]], // lucide: credit-card
  store: [["path", {"d": "M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"}], ["path", {"d": "M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"}], ["path", {"d": "M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"}]], // lucide: store
  package: [["path", {"d": "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"}], ["path", {"d": "M12 22V12"}], ["polyline", {"points": "3.29 7 12 12 20.71 7"}], ["path", {"d": "m7.5 4.27 9 5.15"}]], // lucide: package
  alert: [["path", {"d": "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}], ["path", {"d": "M12 9v4"}], ["path", {"d": "M12 17h.01"}]], // lucide: triangle-alert
  dot: [["circle", {"cx": "12", "cy": "12", "r": "1"}], ["circle", {"cx": "12", "cy": "12", "r": "10"}]], // lucide: circle-dot
  image: [["rect", {"width": "18", "height": "18", "x": "3", "y": "3", "rx": "2", "ry": "2"}], ["circle", {"cx": "9", "cy": "9", "r": "2"}], ["path", {"d": "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]], // lucide: image
  microphone: [["path", {"d": "M12 19v3"}], ["path", {"d": "M19 10v2a7 7 0 0 1-14 0v-2"}], ["rect", {"x": "9", "y": "2", "width": "6", "height": "13", "rx": "3"}]], // lucide: mic
  microphoneOff: [["path", {"d": "M12 19v3"}], ["path", {"d": "M15 9.34V5a3 3 0 0 0-5.68-1.33"}], ["path", {"d": "M16.95 16.95A7 7 0 0 1 5 12v-2"}], ["path", {"d": "M18.89 13.23A7 7 0 0 0 19 12v-2"}], ["path", {"d": "m2 2 20 20"}], ["path", {"d": "M9 9v3a3 3 0 0 0 5.12 2.12"}]], // lucide: mic-off
  send: [["path", {"d": "M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"}], ["path", {"d": "M6 12h16"}]], // lucide: send-horizontal
  plus: [["path", {"d": "M5 12h14"}], ["path", {"d": "M12 5v14"}]], // lucide: plus
  close: [["path", {"d": "M18 6 6 18"}], ["path", {"d": "m6 6 12 12"}]], // lucide: x
  check: [["path", {"d": "M20 6 9 17l-5-5"}]], // lucide: check
  arrowLeft: [["path", {"d": "m12 19-7-7 7-7"}], ["path", {"d": "M19 12H5"}]], // lucide: arrow-left
  chevronRight: [["path", {"d": "m9 18 6-6-6-6"}]], // lucide: chevron-right
  chevronDown: [["path", {"d": "m6 9 6 6 6-6"}]], // lucide: chevron-down
  search: [["path", {"d": "m21 21-4.34-4.34"}], ["circle", {"cx": "11", "cy": "11", "r": "8"}]], // lucide: search
  filter: [["path", {"d": "M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"}]], // lucide: funnel
  edit: [["path", {"d": "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}], ["path", {"d": "m15 5 4 4"}]], // lucide: pencil
  trash: [["path", {"d": "M10 11v6"}], ["path", {"d": "M14 11v6"}], ["path", {"d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}], ["path", {"d": "M3 6h18"}], ["path", {"d": "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]], // lucide: trash
  refresh: [["path", {"d": "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}], ["path", {"d": "M21 3v5h-5"}], ["path", {"d": "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}], ["path", {"d": "M8 16H3v5"}]], // lucide: refresh-cw
  key: [["path", {"d": "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"}], ["circle", {"cx": "16.5", "cy": "7.5", "r": ".5", "fill": "currentColor"}]], // lucide: key-round
  eye: [["path", {"d": "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}], ["circle", {"cx": "12", "cy": "12", "r": "3"}]], // lucide: eye
  clock: [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "M12 6v6l4 2"}]], // lucide: clock
  history: [["path", {"d": "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}], ["path", {"d": "M3 3v5h5"}], ["path", {"d": "M12 7v5l4 2"}]], // lucide: rotate-ccw-clock
  inbox: [["polyline", {"points": "22 12 16 12 14 15 10 15 8 12 2 12"}], ["path", {"d": "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}]], // lucide: inbox
  sparkles: [["path", {"d": "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"}], ["path", {"d": "M20 2v4"}], ["path", {"d": "M22 4h-4"}], ["circle", {"cx": "4", "cy": "20", "r": "2"}]], // lucide: sparkles
  lightbulb: [["path", {"d": "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}], ["path", {"d": "M9 18h6"}], ["path", {"d": "M10 22h4"}]], // lucide: lightbulb
  clipboardList: [["rect", {"width": "8", "height": "4", "x": "8", "y": "2", "rx": "1", "ry": "1"}], ["path", {"d": "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}], ["path", {"d": "M12 11h4"}], ["path", {"d": "M12 16h4"}], ["path", {"d": "M8 11h.01"}], ["path", {"d": "M8 16h.01"}]], // lucide: clipboard-list
  errorCode: [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["line", {"x1": "12", "x2": "12", "y1": "8", "y2": "12"}], ["line", {"x1": "12", "x2": "12.01", "y1": "16", "y2": "16"}]], // lucide: circle-alert
  listOrdered: [["path", {"d": "M11 5h10"}], ["path", {"d": "M11 12h10"}], ["path", {"d": "M11 19h10"}], ["path", {"d": "M4 4h1v5"}], ["path", {"d": "M4 9h2"}], ["path", {"d": "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"}]], // lucide: list-ordered
  approved: [["path", {"d": "M21.801 10A10 10 0 1 1 17 3.335"}], ["path", {"d": "m9 11 3 3L22 4"}]], // lucide: circle-check-big
  rejected: [["circle", {"cx": "12", "cy": "12", "r": "10"}], ["path", {"d": "m15 9-6 6"}], ["path", {"d": "m9 9 6 6"}]], // lucide: circle-x
  hash: [["line", {"x1": "4", "x2": "20", "y1": "9", "y2": "9"}], ["line", {"x1": "4", "x2": "20", "y1": "15", "y2": "15"}], ["line", {"x1": "10", "x2": "8", "y1": "3", "y2": "21"}], ["line", {"x1": "16", "x2": "14", "y1": "3", "y2": "21"}]], // lucide: hash
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
