/**
 * Avatars du Copilote, en SVG dessinés dans le code : aucune image externe.
 *
 * Pour AJOUTER un avatar : ajouter une entrée dans AVATARS (label, couleurs,
 * tracés des cheveux). Il apparaîtra automatiquement dans les paramètres.
 *
 * Les animations (clignement des yeux, bouche qui parle) sont en CSS
 * (components.css) et pilotées par l'attribut data-state du conteneur.
 */

export const AVATARS = Object.freeze({
  female: {
    label: "Technicienne",
    skin: "#f1c3a0",
    hairColor: "#5a3524",
    hairBack: "M33 56 C30 30 44 18 60 18 C77 18 90 30 87 56 C89 72 85 86 79 92 L41 92 C35 86 31 72 33 56 Z",
    hairFront: "M37 48 C38 31 50 25 61 26 C73 27 82 34 83 48 C76 39 66 35 55 37 C47 39 41 43 37 48 Z",
  },
  male: {
    label: "Technicien",
    skin: "#e2a982",
    hairColor: "#33241b",
    hairBack: "",
    hairFront: "M37 50 C34 30 46 21 60 21 C75 21 87 30 83 50 C80 41 73 35 60 35 C48 35 40 41 37 50 Z",
  },
});

export const DEFAULT_AVATAR = "female";

function buildSvg({ skin, hairColor, hairBack, hairFront }) {
  return `
    <svg viewBox="0 0 120 120" role="img" focusable="false" aria-hidden="true">
      ${hairBack ? `<path d="${hairBack}" fill="${hairColor}"/>` : ""}
      <path class="avatar-body" d="M16 120 C18 94 35 83 60 83 C85 83 102 94 104 120 Z" fill="#10243a"/>
      <path d="M47 83 L60 99 L73 83" fill="none" stroke="#168b87" stroke-width="4" stroke-linejoin="round"/>
      <rect x="72" y="102" width="12" height="7" rx="1.5" fill="#85d2c9"/>
      <rect x="52" y="68" width="16" height="17" rx="6" fill="${skin}"/>
      <ellipse cx="60" cy="52" rx="23" ry="25" fill="${skin}"/>
      <path d="${hairFront}" fill="${hairColor}"/>
      <path d="M48 46 Q52 44 55 46 M65 46 Q68 44 72 46" fill="none" stroke="${hairColor}" stroke-width="2" stroke-linecap="round"/>
      <g class="avatar-eyes" fill="#1d2d3d">
        <ellipse cx="51.5" cy="53" rx="2.3" ry="2.9"/>
        <ellipse cx="68.5" cy="53" rx="2.3" ry="2.9"/>
      </g>
      <ellipse cx="46" cy="61" rx="3.6" ry="2" fill="#e88f7a" opacity="0.35"/>
      <ellipse cx="74" cy="61" rx="3.6" ry="2" fill="#e88f7a" opacity="0.35"/>
      <ellipse class="avatar-mouth" cx="60" cy="66" rx="5" ry="1.8" fill="#8a3b3b"/>
      <path d="M35 52 C35 23 85 23 85 52" fill="none" stroke="#168b87" stroke-width="4" stroke-linecap="round"/>
      <rect x="31" y="46" width="7" height="13" rx="3.5" fill="#10243a"/>
      <rect x="82" y="46" width="7" height="13" rx="3.5" fill="#10243a"/>
      <path d="M35 58 C37 70 44 74 52 73" fill="none" stroke="#10243a" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="53.5" cy="73" r="2.6" fill="#168b87"/>
    </svg>`;
}

/**
 * @param {string} kind clé de AVATARS (clé inconnue → avatar par défaut)
 * @returns {HTMLSpanElement} conteneur `.avatar` ; mettre data-state="speaking" pour l'animer
 */
export function renderAvatar(kind, className = "") {
  const avatar = AVATARS[kind] ? kind : DEFAULT_AVATAR;
  const wrapper = document.createElement("span");
  wrapper.className = `avatar ${className}`.trim();
  wrapper.dataset.avatar = avatar;
  wrapper.innerHTML = buildSvg(AVATARS[avatar]); // contenu statique défini ci-dessus, aucune donnée utilisateur
  return wrapper;
}
