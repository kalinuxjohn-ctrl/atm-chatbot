/**
 * Bouton clair / sombre, ajouté dans l'en-tête de chaque page.
 *
 * Le thème est porté par <html data-theme="dark"> (absent = clair, le
 * défaut) et mémorisé dans localStorage. Un petit script en ligne dans le
 * <head> de chaque page l'applique AVANT l'affichage, pour éviter un éclair
 * blanc en mode sombre ; ce module ne fait qu'ajouter le bouton.
 */

import { STORAGE_KEYS } from "../config.js";

const MOON_ICON =
  '<svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const SUN_ICON =
  '<svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

function applyTheme(dark) {
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(STORAGE_KEYS.theme, dark ? "dark" : "light");
  } catch {
    // Stockage indisponible (navigation privée…) : le choix vaut pour cette page.
  }
}

function updateLabel(button) {
  const label = isDark() ? "Passer en mode clair" : "Passer en mode sombre";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function createToggle() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-toggle";
  button.innerHTML = MOON_ICON + SUN_ICON;
  updateLabel(button);
  button.addEventListener("click", () => {
    applyTheme(!isDark());
    updateLabel(button);
  });
  return button;
}

/** Regroupe le bouton et le lien de droite d'un en-tête, pour garder son alignement. */
function placeBeside(link, wrapperClass, button) {
  const wrapper = document.createElement("div");
  wrapper.className = wrapperClass;
  link.replaceWith(wrapper);
  wrapper.append(button, link);
}

function mountThemeToggle() {
  const button = createToggle();
  const copilotActions = document.querySelector(".workspace-actions");
  const siteHeaderLink = document.querySelector(".site-header > .header-action");
  const flowBackLink = document.querySelector(".topbar > .back-link");

  if (copilotActions) copilotActions.insertBefore(button, copilotActions.lastElementChild);
  else if (siteHeaderLink) placeBeside(siteHeaderLink, "header-tools", button);
  else if (flowBackLink) placeBeside(flowBackLink, "topbar-tools", button);
}

mountThemeToggle();
