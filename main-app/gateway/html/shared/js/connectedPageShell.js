/**
 * Socle de chaque page connectée : navigation adaptée à l'orientation,
 * utilisateur courant, thèmes, déconnexion, et
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
import { createAppSettings } from "./appSettings.js";
import { confirmAction } from "./confirmationDialog.js";
import { startMessageNotifications } from "./messageNotifications.js";

const NAVIGATION_LINKS = [
  { label: "Accueil", path: "/", iconName: "home" },
  { label: "ATM-Chatbot", path: "/atm-chatbot/", iconName: "bot" },
  { label: "Carte", path: "/map/", iconName: "map" },
  { label: "Messagerie", path: "/messaging/", iconName: "message" },
  { label: "Appels", path: "/calls/", iconName: "phone" },
  { label: "Paramètres", path: "#app-settings", iconName: "settings" },
];
// Visible seulement pour le rôle admin : comptes + validation et réponses de l’ATM-Chatbot.
const ADMINISTRATION_LINK = { label: "Administration", path: "/admin/", iconName: "shield" };
const ADMINISTRATION_SECTIONS = [
  { name: "comptes", label: "Comptes", iconName: "users" },
  { name: "propositions", label: "Propositions", iconName: "lightbulb", pending: true },
  { name: "interventions", label: "Ajouts d’intervention", iconName: "clipboardList", pending: true },
  { name: "codes-erreur", label: "Codes d’erreur", iconName: "errorCode" },
  { name: "pannes-frequentes", label: "Pannes fréquentes", iconName: "listOrdered" },
];
const THEME_STORAGE_KEY = "main-app-theme"; // même clé que applySavedTheme.js
const SIDEBAR_STORAGE_KEY = "main-app-sidebar";

function readSidebarMode() {
  try {
    const savedMode = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (savedMode === "expanded" || savedMode === "collapsed") return savedMode;
  } catch (error) {
    console.warn("Préférence du menu indisponible.", error.name);
  }
  return window.matchMedia("(max-width: 1100px)").matches ? "collapsed" : "expanded";
}

document.body.dataset.sidebarMode = readSidebarMode();
let chatbotMenuOpen = false;
let administrationMenuOpen = window.location.pathname.startsWith("/admin/")
  && !window.matchMedia("(max-width: 720px), (max-height: 600px) and (orientation: landscape)").matches;

function createAdministrationMenu() {
  const menu = createElementWithText("details", "app-chatbot-menu app-administration-menu");
  menu.open = administrationMenuOpen;
  const summary = createElementWithText("summary", "app-navigation-link");
  summary.title = ADMINISTRATION_LINK.label;
  if (isCurrentPage(ADMINISTRATION_LINK.path)) summary.classList.add("is-current");
  summary.append(createIcon("shield"), createElementWithText("span", "app-navigation-link-label", "Administration"),
    createIcon("chevronRight", "icon app-chatbot-chevron"));
  const submenu = createElementWithText("div", "app-chatbot-subnavigation app-administration-subnavigation");
  for (const section of ADMINISTRATION_SECTIONS) {
    const link = createElementWithText("a", "app-chatbot-action app-administration-action");
    link.href = `/admin/#${section.name}`;
    link.dataset.sectionLink = section.name;
    link.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 720px), (max-height: 600px) and (orientation: landscape)").matches) {
        menu.open = false;
        summary.focus();
      }
    });
    link.append(createIcon(section.iconName), createElementWithText("span", "app-administration-label", section.label));
    const counter = createElementWithText("span", "app-administration-counter");
    counter.dataset.sectionCounter = section.name;
    counter.hidden = true;
    if (section.pending) counter.classList.add("is-pending");
    link.append(counter);
    submenu.append(link);
  }
  menu.append(summary, submenu);
  menu.addEventListener("toggle", () => { administrationMenuOpen = menu.open; });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.open = false;
      summary.focus();
    }
  });
  return menu;
}

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
  if (path === "#app-settings") {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      appSettings.open();
    });
    link.setAttribute("aria-haspopup", "dialog");
  } else if (isCurrentPage(path)) {
    link.setAttribute("aria-current", "page");
  }
  link.append(createIcon(iconName), createElementWithText("span", "app-navigation-link-label", label));
  return link;
}

// --- Thème clair / sombre ------------------------------------------------------

export function applyAppTheme(theme) {
  if (!["dark", "light", "gab"].includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("Préférence du thème non enregistrée.", error.name);
  }
}

const appSettings = createAppSettings({ applyTheme: applyAppTheme });

export function openAppSettings(options) {
  appSettings.open(options);
}

function createSidebarToggleButton() {
  const toggleButton = createElementWithText("button", "icon-button app-sidebar-toggle app-sidebar-footer-button");
  toggleButton.type = "button";
  toggleButton.setAttribute("aria-controls", "main-app-navigation");
  const refreshButton = () => {
    const expanded = document.body.dataset.sidebarMode === "expanded";
    toggleButton.setAttribute("aria-label", expanded ? "Rétracter la barre latérale" : "Déployer la barre latérale");
    toggleButton.setAttribute("aria-expanded", String(expanded));
    toggleButton.title = toggleButton.getAttribute("aria-label");
    toggleButton.replaceChildren(createIcon("chevronRight"),
      createElementWithText("span", "button-label", expanded ? "Réduire le menu" : "Déployer le menu"));
  };
  toggleButton.addEventListener("click", () => {
    const mode = document.body.dataset.sidebarMode === "expanded" ? "collapsed" : "expanded";
    document.body.dataset.sidebarMode = mode;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, mode);
    } catch (error) {
      console.warn("Préférence du menu non enregistrée.", error.name);
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
  brandLink.setAttribute("aria-label", currentUser
    ? `Accueil de l’application — ${currentUser.username}`
    : "Accueil de l’application");
  const brandLogo = currentUser
    ? createAvatar(currentUser.username)
    : createElementWithText("span", "app-sidebar-brand-logo");
  if (!currentUser) brandLogo.append(createIcon("wrench"));
  const brandText = createElementWithText("span", "app-sidebar-brand-text");
  brandText.append(createElementWithText("strong", "", currentUser ? `Bonjour, ${currentUser.username}` : "Bienvenue"));
  if (currentUser) {
    brandText.append(createElementWithText("span", "app-sidebar-brand-role", describeRole(currentUser.role)));
  }
  brandLink.append(brandLogo, brandText);

  const navigation = createElementWithText("nav", "app-navigation");
  navigation.id = "main-app-navigation";
  navigation.setAttribute("aria-label", "Navigation principale");
  if (currentUser?.role === "admin") {
    navigation.append(createElementWithText("p", "app-sidebar-section-title", "Gestion"), createAdministrationMenu());
  }
  navigation.append(createElementWithText("p", "app-sidebar-section-title", "Espace de travail"));
  for (const item of NAVIGATION_LINKS) {
    if (item.path === "/atm-chatbot/") {
      const dropdown = createElementWithText("details", "app-chatbot-menu");
      dropdown.open = chatbotMenuOpen;
      const summary = createElementWithText("summary", "app-navigation-link");
      summary.title = "Menu ATM-Chatbot";
      if (isCurrentPage(item.path)) summary.classList.add("is-current");
      summary.append(createIcon("bot"), createElementWithText("span", "app-navigation-link-label", item.label), createIcon("chevronRight", "icon app-chatbot-chevron"));
      dropdown.append(summary);
      dropdown.addEventListener("toggle", () => { chatbotMenuOpen = dropdown.open; });
      dropdown.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          dropdown.open = false;
          summary.focus();
        }
      });
      const subnavigation = createElementWithText("div", "app-chatbot-subnavigation");
      for (const [action, label, iconName] of [
        ["conversation", "Conversation", "message"],
        ["new-conversation", "Nouvelle conversation", "plus"],
      ]) {
        const link = createElementWithText("a", "app-chatbot-action");
        link.append(createIcon(iconName), createElementWithText("span", "", label));
        link.href = action === "conversation" ? "/atm-chatbot/" : `/atm-chatbot/#${action}`;
        link.dataset.chatbotAction = action;
        link.addEventListener("click", () => {
          chatbotMenuOpen = false;
          dropdown.open = false;
        });
        subnavigation.append(link);
      }
      dropdown.append(subnavigation);
      navigation.append(dropdown);
    } else {
      navigation.append(createNavigationLink(item));
    }
  }

  const footer = createElementWithText("div", "app-sidebar-footer");
  footer.append(createSidebarToggleButton());
  const actions = createElementWithText("div", "app-sidebar-actions");
  if (currentUser) {
    const logoutButton = createElementWithText("button", "icon-button app-sidebar-footer-button app-sidebar-logout");
    logoutButton.type = "button";
    logoutButton.setAttribute("aria-label", "Déconnexion");
    logoutButton.title = "Déconnexion";
    logoutButton.append(createIcon("logout"), createElementWithText("span", "button-label", "Déconnexion"));
    logoutButton.addEventListener("click", async () => {
      const confirmed = await confirmAction({
        title: "Confirmer la déconnexion",
        message: "Voulez-vous vraiment vous déconnecter ?",
        confirmLabel: "Oui, me déconnecter",
        cancelLabel: "Non",
        danger: true,
      });
      if (!confirmed) return;
      try {
        await requestJson("/api/auth/logout", { method: "POST" });
        window.location.assign("/auth/login.html");
      } catch (error) {
        console.error("La déconnexion a échoué.", error);
        const notice = createElementWithText("p", "app-sidebar-error", "Déconnexion impossible. Vérifiez votre connexion puis réessayez.");
        notice.setAttribute("role", "alert");
        actions.replaceChildren(notice, logoutButton);
      }
    });
    actions.append(logoutButton);
  }
  footer.append(actions);

  const sidebarHeader = createElementWithText("div", "app-sidebar-header");
  sidebarHeader.append(brandLink);
  headerElement.replaceChildren(sidebarHeader, navigation, footer);
  window.dispatchEvent(new Event("main-app:shell-rendered"));

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
  startMessageNotifications(currentUser);
});
if (document.body.dataset.ownsCallSocket !== "true") {
  startIncomingCallListener();
}
