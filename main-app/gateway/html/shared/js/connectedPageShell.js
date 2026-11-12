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
  { label: "ATM-Chatbot", path: "/atm-chatbot/", iconName: "bot", submenu: true },
  { label: "Carte", path: "/map/", iconName: "map" },
  { label: "Messagerie", path: "/messaging/", iconName: "message" },
  { label: "Appels", path: "/calls/", iconName: "phone" },
  { label: "Paramètres", path: "#app-settings", iconName: "settings" },
];
// Visible seulement pour le rôle admin : comptes + validation et réponses de l’ATM-Chatbot.
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
function createNavigationSection(label) {
  const section = createElementWithText("div", "app-navigation-section");
  section.setAttribute("role", "group");
  section.setAttribute("aria-label", label);
  section.append(createElementWithText("p", "app-sidebar-section-title", label));
  return section;
}

function createAdministrationSection() {
  const group = createNavigationSection("Administration");
  for (const section of ADMINISTRATION_SECTIONS) {
    const link = createNavigationLink({
      label: section.label, path: `/admin/#${section.name}`, iconName: section.iconName,
    });
    link.dataset.sectionLink = section.name;
    const counter = createElementWithText("span", "app-administration-counter");
    counter.dataset.sectionCounter = section.name;
    counter.hidden = true;
    if (section.pending) counter.classList.add("is-pending");
    link.append(counter);
    group.append(link);
  }
  return group;
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
  if (path.includes("#")) {
    const [pathname, hash] = path.split("#");
    const currentHash = window.location.hash.slice(1)
      || (pathname === "/admin/" ? "propositions" : "");
    return window.location.pathname === pathname && currentHash === hash;
  }
  if (path === "/") {
    return window.location.pathname === "/";
  }
  return window.location.pathname.startsWith(path.replace(/[^/]+\.html$/, ""))
    && window.location.hash !== "#new-conversation";
}

function createNavigationLink({ label, path, iconName }) {
  const link = createElementWithText("a", "app-navigation-link");
  link.href = path;
  link.title = label; // libellé visible au survol quand le rail n'affiche que les icônes
  link.setAttribute("aria-label", label);
  if (path === "/atm-chatbot/#new-conversation") link.dataset.chatbotAction = "new-conversation";
  if (path === "/atm-chatbot/#conversations") link.dataset.chatbotAction = "conversations";
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

function createChatbotMenu() {
  const menu = createElementWithText("details", "app-chatbot-menu");
  menu.open = document.body.dataset.sidebarMode === "expanded"
    && !window.matchMedia("(max-width: 720px), (max-height: 600px) and (orientation: landscape)").matches
    && window.location.pathname.startsWith("/atm-chatbot/");
  const summary = createElementWithText("summary", "app-navigation-link");
  summary.title = "ATM-Chatbot";
  summary.setAttribute("aria-label", "ATM-Chatbot");
  summary.append(createIcon("bot"), createElementWithText("span", "app-navigation-link-label", "ATM-Chatbot"),
    createIcon("chevronRight", "icon app-chatbot-chevron"));
  const subnavigation = createElementWithText("div", "app-chatbot-subnavigation");
  for (const item of [
    { label: "Nouvelle conversation", path: "/atm-chatbot/#new-conversation", iconName: "plus" },
    { label: "Voir les conversations", path: "/atm-chatbot/#conversations", iconName: "history" },
  ]) {
    const link = createNavigationLink(item);
    link.className = "app-chatbot-action";
    subnavigation.append(link);
  }
  summary.addEventListener("click", (event) => {
    const compact = document.body.dataset.sidebarMode === "collapsed"
      || window.matchMedia("(max-width: 720px), (max-height: 600px) and (orientation: landscape)").matches;
    if (!compact || typeof subnavigation.showPopover !== "function") return;
    event.preventDefault();
    if (subnavigation.matches(":popover-open")) {
      subnavigation.hidePopover();
      return;
    }
    menu.open = true;
    subnavigation.setAttribute("popover", "auto");
    const bounds = summary.getBoundingClientRect();
    const width = Math.min(230, window.innerWidth - 16);
    const left = Math.min(bounds.right + 12, window.innerWidth - width - 8);
    const top = Math.max(8, Math.min(bounds.top, window.innerHeight - 140));
    subnavigation.style.setProperty("--chatbot-menu-left", `${Math.max(8, left)}px`);
    subnavigation.style.setProperty("--chatbot-menu-top", `${top}px`);
    subnavigation.showPopover();
    const controller = new AbortController();
    const close = () => subnavigation.hidePopover();
    window.addEventListener("resize", close, { signal: controller.signal, once: true });
    subnavigation.addEventListener("toggle", (toggleEvent) => {
      if (toggleEvent.newState !== "closed") return;
      controller.abort();
      menu.open = false;
      subnavigation.removeAttribute("popover");
    }, { signal: controller.signal });
  });
  subnavigation.addEventListener("click", (event) => {
    if (event.target.closest("a") && subnavigation.matches(":popover-open")) subnavigation.hidePopover();
  });
  menu.append(summary, subnavigation);
  return menu;
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
  const toggleIcon = createIcon("collapseSidebar", "icon app-sidebar-toggle-icon");
  const toggleLabel = createElementWithText("span", "button-label");
  toggleButton.append(toggleIcon, toggleLabel);
  const refreshButton = () => {
    const expanded = document.body.dataset.sidebarMode === "expanded";
    toggleButton.setAttribute("aria-label", expanded ? "Rétracter la barre latérale" : "Déployer la barre latérale");
    toggleButton.setAttribute("aria-expanded", String(expanded));
    toggleButton.title = toggleButton.getAttribute("aria-label");
    toggleLabel.textContent = expanded ? "Réduire le menu" : "Déployer le menu";
  };
  toggleButton.addEventListener("click", () => {
    const mode = document.body.dataset.sidebarMode === "expanded" ? "collapsed" : "expanded";
    for (const menu of document.querySelectorAll(".app-chatbot-menu")) {
      const panel = menu.querySelector(".app-chatbot-subnavigation");
      if (panel?.matches(":popover-open")) panel.hidePopover();
      menu.open = false;
    }
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
    navigation.append(createAdministrationSection());
  }
  const appSection = createNavigationSection("Fonctionnalités");
  for (const item of NAVIGATION_LINKS) {
    appSection.append(item.submenu ? createChatbotMenu() : createNavigationLink(item));
  }
  navigation.append(appSection);

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
window.addEventListener("hashchange", () => {
  for (const link of pageShellHeader?.querySelectorAll(".app-navigation a:not([aria-haspopup])") ?? []) {
    if (isCurrentPage(link.getAttribute("href"))) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
});
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
