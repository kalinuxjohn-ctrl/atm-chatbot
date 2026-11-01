/**
 * Socle de chaque page connectée : en-tête de navigation, utilisateur
 * courant, déconnexion, et écoute des appels entrants.
 *
 * Utilisation dans une page :
 *   <header data-page-shell></header>
 *   <script type="module" src="/shared/js/connectedPageShell.js"></script>
 *
 * Une page qui gère elle-même le WebSocket des appels (la page Appels)
 * met data-owns-call-socket="true" sur <body> pour ne pas en ouvrir un second.
 *
 * Si le conteneur auth est arrêté, /api/auth/me répond 503 : la page reste
 * utilisable (chaque conteneur vérifie la session lui-même), seul le nom
 * de l'utilisateur et la déconnexion manquent.
 */

import { ApiRequestError, redirectToLoginPage, requestJson } from "./apiClient.js";
import { createButton, createElementWithText } from "./domHelpers.js";
import { startIncomingCallListener } from "./incomingCallListener.js";

const NAVIGATION_LINKS = [
  { label: "Accueil", path: "/" },
  { label: "Carte", path: "/map/" },
  { label: "Messagerie", path: "/messaging/" },
  { label: "Appels", path: "/calls/" },
];

async function loadCurrentUser() {
  try {
    const { user } = await requestJson("/api/auth/me");
    return user;
  } catch (error) {
    if (error instanceof ApiRequestError && error.httpStatus === 401) {
      redirectToLoginPage();
      return new Promise(() => {}); // la page est en train de changer
    }
    return null; // auth indisponible : on continue sans le nom
  }
}

function renderPageShellHeader(headerElement, currentUser) {
  headerElement.className = "page-shell-header";
  const brandLink = createElementWithText("a", "page-shell-brand", "Espace techniciens");
  brandLink.href = "/";

  const navigation = createElementWithText("nav", "page-shell-navigation");
  navigation.setAttribute("aria-label", "Navigation principale");
  const links = currentUser?.role === "admin" ? [...NAVIGATION_LINKS, { label: "Comptes", path: "/auth/accounts.html" }] : NAVIGATION_LINKS;
  for (const { label, path } of links) {
    const link = createElementWithText("a", "", label);
    link.href = path;
    const isCurrentPage = path === "/" ? window.location.pathname === "/" : window.location.pathname.startsWith(path.replace(/[^/]+\.html$/, ""));
    if (isCurrentPage) {
      link.setAttribute("aria-current", "page");
    }
    navigation.append(link);
  }

  const userArea = createElementWithText("div", "page-shell-user");
  if (currentUser) {
    userArea.append(createElementWithText("span", "", `${currentUser.username} · ${describeRole(currentUser.role)}`));
    userArea.append(
      createButton("Déconnexion", {
        className: "button button-secondary",
        onClick: async () => {
          await requestJson("/api/auth/logout", { method: "POST" }).catch(() => {});
          window.location.assign("/auth/login.html");
        },
      }),
    );
  }

  headerElement.replaceChildren(brandLink, navigation, userArea);
  if (!currentUser) {
    headerElement.after(
      createElementWithText("div", "page-shell-notice", "Service de connexion momentanément indisponible : la page reste utilisable."),
    );
  }
}

function describeRole(role) {
  return { technician: "technicien", moderator: "modérateur", admin: "administrateur" }[role] ?? role;
}

/** Promesse de l'utilisateur connecté (null si auth est indisponible), réutilisable par la page. */
export const currentUserPromise = loadCurrentUser();

const pageShellHeader = document.querySelector("[data-page-shell]");
currentUserPromise.then((currentUser) => {
  if (pageShellHeader) {
    renderPageShellHeader(pageShellHeader, currentUser);
  }
});
if (document.body.dataset.ownsCallSocket !== "true") {
  startIncomingCallListener();
}
