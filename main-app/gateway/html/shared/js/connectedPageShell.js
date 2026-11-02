/**
 * Socle de chaque page connectée : navigation (rail à gauche, onglets en bas
 * sur mobile), utilisateur courant, thème clair / sombre, déconnexion, et
 * écoute des appels entrants.
 *
 * Utilisation dans une page :
 *   <script src="/shared/js/applySavedTheme.js"></script>       (thème, avant l'affichage)
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
import { createAvatar, createElementWithText } from "./domHelpers.js";
import { createIcon, replaceIconPlaceholders } from "./icons.js";
import { startIncomingCallListener } from "./incomingCallListener.js";

const NAVIGATION_LINKS = [
  { label: "Accueil", path: "/", iconName: "home" },
  { label: "Carte", path: "/map/", iconName: "map" },
  { label: "Messagerie", path: "/messaging/", iconName: "message" },
  { label: "Appels", path: "/calls/", iconName: "phone" },
];
const ADMINISTRATION_LINK = { label: "Comptes", path: "/auth/accounts.html", iconName: "users" };
const THEME_STORAGE_KEY = "main-app-theme"; // même clé que applySavedTheme.js

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

function describeRole(role) {
  return { technician: "Technicien", moderator: "Modérateur", admin: "Administrateur" }[role] ?? role;
}

function isCurrentPage(path) {
  if (path === "/") {
    return window.location.pathname === "/";
  }
  return window.location.pathname.startsWith(path.replace(/[^/]+\.html$/, ""));
}

function createNavigationLink({ label, path, iconName }) {
  const link = createElementWithText("a", "app-navigation-link");
  link.href = path;
  link.title = label; // libellé visible au survol quand le rail n'affiche que les icônes
  if (isCurrentPage(path)) {
    link.setAttribute("aria-current", "page");
  }
  link.append(createIcon(iconName), createElementWithText("span", "app-navigation-link-label", label));
  return link;
}

// --- Thème clair / sombre ------------------------------------------------------

function readCurrentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function createThemeToggleButton() {
  const toggleButton = createElementWithText("button", "icon-button");
  toggleButton.type = "button";
  const refreshButton = () => {
    const nextTheme = readCurrentTheme() === "dark" ? "clair" : "sombre";
    toggleButton.setAttribute("aria-label", `Passer en thème ${nextTheme}`);
    toggleButton.title = `Thème ${nextTheme}`;
    toggleButton.replaceChildren(createIcon(readCurrentTheme() === "dark" ? "sun" : "moon"));
  };
  toggleButton.addEventListener("click", () => {
    const newTheme = readCurrentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = newTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // Stockage refusé (navigation privée) : le choix vaut pour cette page seulement.
    }
    refreshButton();
  });
  refreshButton();
  return toggleButton;
}

// --- Rendu ------------------------------------------------------------------------

/**
 * Dessine le rail. Appelé deux fois : tout de suite (isLoadingUser, sans
 * utilisateur) pour que la page ne saute pas, puis quand /api/auth/me répond.
 */
function renderPageShell(headerElement, currentUser, { isLoadingUser = false } = {}) {
  headerElement.className = "app-sidebar";
  document.body.classList.add("has-app-sidebar");

  const brandLink = createElementWithText("a", "app-sidebar-brand");
  brandLink.href = "/";
  const brandLogo = createElementWithText("span", "app-sidebar-brand-logo");
  brandLogo.append(createIcon("wrench"));
  const brandText = createElementWithText("span", "app-sidebar-brand-text");
  brandText.append(createElementWithText("strong", "", "Espace techniciens"), createElementWithText("span", "", "GAB · TPE · terrain"));
  brandLink.append(brandLogo, brandText);

  const navigation = createElementWithText("nav", "app-navigation");
  navigation.setAttribute("aria-label", "Navigation principale");
  const links = currentUser?.role === "admin" ? [...NAVIGATION_LINKS, ADMINISTRATION_LINK] : NAVIGATION_LINKS;
  navigation.append(createElementWithText("p", "app-sidebar-section-title", "Espace de travail"), ...links.map(createNavigationLink));

  const footer = createElementWithText("div", "app-sidebar-footer");
  if (currentUser) {
    const userArea = createElementWithText("div", "app-sidebar-user");
    const userText = createElementWithText("span", "app-sidebar-user-text");
    userText.append(
      createElementWithText("span", "app-sidebar-user-name", currentUser.username),
      createElementWithText("span", "app-sidebar-user-role", describeRole(currentUser.role)),
    );
    userArea.append(createAvatar(currentUser.username), userText);
    footer.append(userArea);
  }
  const actions = createElementWithText("div", "app-sidebar-actions");
  actions.append(createThemeToggleButton());
  if (currentUser) {
    const logoutButton = createElementWithText("button", "icon-button");
    logoutButton.type = "button";
    logoutButton.setAttribute("aria-label", "Déconnexion");
    logoutButton.title = "Déconnexion";
    logoutButton.append(createIcon("logout"));
    logoutButton.addEventListener("click", async () => {
      await requestJson("/api/auth/logout", { method: "POST" }).catch(() => {});
      window.location.assign("/auth/login.html");
    });
    actions.append(logoutButton);
  }
  footer.append(actions);

  headerElement.replaceChildren(brandLink, navigation, footer);

  if (!currentUser && !isLoadingUser) {
    const notice = createElementWithText("div", "page-shell-notice", "Service de connexion momentanément indisponible : la page reste utilisable.");
    const pageContent = document.querySelector("main") ?? headerElement.nextElementSibling;
    pageContent?.prepend(notice);
  }
}

/** Promesse de l'utilisateur connecté (null si auth est indisponible), réutilisable par la page. */
export const currentUserPromise = loadCurrentUser();

replaceIconPlaceholders();
const pageShellHeader = document.querySelector("[data-page-shell]");
if (pageShellHeader) {
  renderPageShell(pageShellHeader, null, { isLoadingUser: true });
}
currentUserPromise.then((currentUser) => {
  if (pageShellHeader) {
    renderPageShell(pageShellHeader, currentUser);
  }
});
if (document.body.dataset.ownsCallSocket !== "true") {
  startIncomingCallListener();
}
