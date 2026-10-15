/**
 * Interrupteur clair / sombre (soleil | lune), ajouté dans l'en-tête de
 * chaque page.
 *
 * Le thème est porté par <html data-theme="dark"> (absent = clair, le
 * défaut) et mémorisé dans localStorage. Un petit script en ligne dans le
 * <head> de chaque page l'applique AVANT l'affichage, pour éviter un éclair
 * blanc en mode sombre ; ce module ne fait qu'ajouter l'interrupteur.
 */

import { STORAGE_KEYS } from "../config.js";

const ICONS = {
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  dark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};
const LABELS = { light: "Mode clair", dark: "Mode sombre" };

const currentTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function applyTheme(theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  } catch {
    // Stockage indisponible (navigation privée…) : le choix vaut pour cette page.
  }
}

function createSwitch() {
  const group = document.createElement("div");
  group.className = "theme-switch";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Thème de l’affichage");

  const buttons = Object.keys(ICONS).map((theme) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-switch-option";
    button.dataset.theme = theme;
    button.innerHTML = ICONS[theme];
    button.setAttribute("aria-label", LABELS[theme]);
    button.title = LABELS[theme];
    group.append(button);
    return button;
  });

  const render = () =>
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.theme === currentTheme())));

  group.addEventListener("click", (event) => {
    const button = event.target.closest(".theme-switch-option");
    if (!button) return;
    applyTheme(button.dataset.theme);
    render();
  });
  render();
  return group;
}

/** Regroupe l'interrupteur et le lien de droite d'un en-tête, pour garder son alignement. */
function placeBeside(link, wrapperClass, element) {
  const wrapper = document.createElement("div");
  wrapper.className = wrapperClass;
  link.replaceWith(wrapper);
  wrapper.append(element, link);
}

function mountThemeSwitch() {
  const themeSwitch = createSwitch();
  const topbarTools = document.querySelector(".app-topbar .topbar-tools");
  const siteHeaderLink = document.querySelector(".site-header > .header-action");
  const flowBackLink = document.querySelector(".topbar > .back-link");

  if (topbarTools) topbarTools.prepend(themeSwitch);
  else if (siteHeaderLink) placeBeside(siteHeaderLink, "header-tools", themeSwitch);
  else if (flowBackLink) placeBeside(flowBackLink, "topbar-tools", themeSwitch);
}

mountThemeSwitch();
