/**
 * Avatars du Copilote (messages, barre du haut, page d'accueil, paramètres).
 *
 * Deux façons de définir un avatar dans AVATARS :
 *   1. DESSIN SVG en code (par défaut) : couleurs + tracés des cheveux.
 *      Les animations (yeux qui clignent, bouche qui parle) ne marchent
 *      qu'avec ce mode -- elles sont en CSS (components.css).
 *   2. IMAGE : ajouter `image: "/assets/avatars/mon-avatar.png"` à l'entrée.
 *      L'image remplace le dessin (pas d'animation). Mode d'emploi :
 *      public/assets/README.md
 *
 * Pour AJOUTER un avatar : ajouter une entrée ici. Il apparaît
 * automatiquement dans les paramètres.
 */

export const AVATARS = Object.freeze({
  female: {
    label: "Technicienne",
    // image: "/assets/avatars/technicienne.png",  // décommenter pour utiliser une image
    skin: "#f1c3a0",
    hairColor: "#5a3524",
    hairBack: "M33 56 C30 30 44 18 60 18 C77 18 90 30 87 56 C89 72 85 86 79 92 L41 92 C35 86 31 72 33 56 Z",
    hairFront: "M37 48 C38 31 50 25 61 26 C73 27 82 34 83 48 C76 39 66 35 55 37 C47 39 41 43 37 48 Z",
  },
  male: {
    label: "Technicien",
    // image: "/assets/avatars/technicien.png",  // décommenter pour utiliser une image
    skin: "#e2a982",
    hairColor: "#33241b",
    hairBack: "",
    hairFront: "M37 50 C34 30 46 21 60 21 C75 21 87 30 83 50 C80 41 73 35 60 35 C48 35 40 41 37 50 Z",
  },
  robot: {
    label: "Robot",
    robotic: true,
  },
});

export const DEFAULT_AVATAR = "female";

function buildSvg({ skin, hairColor, hairBack, hairFront, robotic = false }) {
  if (robotic) {
    return `
      <svg viewBox="0 0 120 120" role="img" focusable="false" aria-hidden="true">
        <path class="avatar-body" d="M22 120 V103 Q22 86 40 86 H80 Q98 86 98 103 V120" fill="#183a55"/>
        <rect x="43" y="96" width="34" height="19" rx="6" fill="#0b243c" stroke="#91d9f4" stroke-width="2"/>
        <circle cx="53" cy="105" r="3" fill="#5ce5d1"/>
        <path d="M62 105 H70" stroke="#91d9f4" stroke-width="3" stroke-linecap="round"/>
        <rect x="51" y="74" width="18" height="16" rx="4" fill="#779eb8"/>
        <g class="avatar-head">
          <path d="M60 23 V14" stroke="#91d9f4" stroke-width="4"/>
          <circle cx="60" cy="12" r="5" fill="#5ce5d1"/>
          <rect x="25" y="43" width="9" height="22" rx="4" fill="#779eb8"/>
          <rect x="86" y="43" width="9" height="22" rx="4" fill="#779eb8"/>
          <rect x="31" y="25" width="58" height="55" rx="17" fill="#c4e3ef" stroke="#779eb8" stroke-width="2"/>
          <rect x="37" y="35" width="46" height="36" rx="11" fill="#0b243c"/>
          <g stroke="#91d9f4" stroke-width="2" stroke-linecap="round">
            <path class="avatar-brow-left" d="M44 44 H53"/>
            <path class="avatar-brow-right" d="M67 44 H76"/>
          </g>
          <g class="avatar-eyes" fill="#5ce5d1">
            <rect x="45" y="48" width="7" height="8" rx="3"/>
            <rect x="68" y="48" width="7" height="8" rx="3"/>
          </g>
          <ellipse class="avatar-mouth" cx="60" cy="63" rx="6" ry="1.5" fill="#91d9f4"/>
        </g>
        <g class="avatar-thinking-arm">
          <path d="M87 109 Q97 99 81 86" fill="none" stroke="#779eb8" stroke-width="13" stroke-linecap="round"/>
          <path d="M81 86 L73 74" fill="none" stroke="#c4e3ef" stroke-width="9" stroke-linecap="round"/>
          <path d="M74 76 H64 Q59 76 59 71 V67 M64 71 V65" fill="none" stroke="#c4e3ef" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="84" cy="89" r="4" fill="#5ce5d1"/>
        </g>
      </svg>`;
  }
  return `
    <svg viewBox="0 0 120 120" role="img" focusable="false" aria-hidden="true">
      ${hairBack ? `<path d="${hairBack}" fill="${hairColor}"/>` : ""}
      <path class="avatar-body" d="M16 120 C18 94 35 83 60 83 C85 83 102 94 104 120 Z" fill="#10243a"/>
      <path d="M47 83 L60 99 L73 83" fill="none" stroke="#168b87" stroke-width="4" stroke-linejoin="round"/>
      <rect x="72" y="102" width="12" height="7" rx="1.5" fill="#85d2c9"/>
      <rect x="52" y="68" width="16" height="17" rx="6" fill="${skin}"/>
      <g class="avatar-head">
      <ellipse cx="60" cy="52" rx="23" ry="25" fill="${skin}"/>
      <path d="${hairFront}" fill="${hairColor}"/>
      <g fill="none" stroke="${hairColor}" stroke-width="2" stroke-linecap="round">
        <path class="avatar-brow-left" d="M48 46 Q52 44 55 46"/>
        <path class="avatar-brow-right" d="M65 46 Q68 44 72 46"/>
      </g>
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
      </g>
      <g class="avatar-thinking-arm">
        <path d="M87 109 Q95 99 83 87" fill="none" stroke="#183a55" stroke-width="15" stroke-linecap="round"/>
        <path d="M83 87 L72 73" fill="none" stroke="${skin}" stroke-width="10" stroke-linecap="round"/>
        <path d="M72 74 Q66 77 59 73 L57 70 Q57 67 60 68 L66 70 L66 63 Q66 60 69 61 L74 69 Z" fill="${skin}" stroke="#b77e61" stroke-width="0.8" stroke-linejoin="round"/>
      </g>
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

  const { image, label } = AVATARS[avatar];
  if (image) {
    const picture = document.createElement("img");
    picture.className = "avatar-image";
    picture.src = image;
    picture.alt = "";
    picture.setAttribute("aria-hidden", "true");
    // Chemin erroné ou fichier absent : on revient au dessin plutôt que d'afficher une image cassée.
    picture.addEventListener("error", () => {
      console.warn(`[avatar] Image introuvable pour « ${label} » : ${image} -- dessin SVG utilisé à la place.`);
      wrapper.innerHTML = buildSvg(AVATARS[avatar]);
    }, { once: true });
    wrapper.append(picture);
    return wrapper;
  }

  wrapper.innerHTML = buildSvg(AVATARS[avatar]); // contenu statique défini ci-dessus, aucune donnée utilisateur
  return wrapper;
}
