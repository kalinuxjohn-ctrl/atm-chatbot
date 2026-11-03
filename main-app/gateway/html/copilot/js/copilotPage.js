/**
 * Onglet Copilote : affiche le frontend du chatbot dans une iframe, sous la
 * navigation de l'Espace techniciens.
 *
 *   1. lit l'adresse du chatbot dans /copilot/settings.json (fournie par le gateway) ;
 *   2. charge <adresse>/copilot.html?embedded=1&theme=…&technician_id=… : en mode
 *      « embedded », le chatbot masque sa propre barre du haut et reprend le
 *      technicien connecté ici, sans autre connexion (voir frontend/public/js/embeddedMode.js) ;
 *   3. quand l'utilisateur change de thème ici, prévient l'iframe (postMessage)
 *      pour que le Copilote suive sans recharger.
 */

import { requestJson } from "/shared/js/apiClient.js";
import { currentUserPromise } from "/shared/js/connectedPageShell.js";

const COPILOT_PAGE_PATH = "/copilot.html";
// Même valeur que THEME_MESSAGE_TYPE dans frontend/public/js/embeddedMode.js (chatbot).
const THEME_MESSAGE_TYPE = "espace-techniciens:theme";

const copilotFrame = document.querySelector("[data-copilot-frame]");
const loadingPanel = document.querySelector("[data-copilot-loading]");
const unavailablePanel = document.querySelector("[data-copilot-unavailable]");
const openInNewTabLink = document.querySelector("[data-copilot-open-link]");

const readCurrentTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function showCopilotNotConfigured() {
  loadingPanel.hidden = true;
  unavailablePanel.hidden = false;
  openInNewTabLink.parentElement.hidden = true;
}

let chatbotOrigin;
try {
  const { chatbotUrl } = await requestJson("/copilot/settings.json");
  chatbotOrigin = chatbotUrl ? new URL(chatbotUrl).origin : null;
} catch {
  chatbotOrigin = null;
}

if (!chatbotOrigin) {
  showCopilotNotConfigured();
} else {
  const embeddedPageUrl = new URL(COPILOT_PAGE_PATH, chatbotOrigin);
  embeddedPageUrl.searchParams.set("embedded", "1");
  embeddedPageUrl.searchParams.set("theme", readCurrentTheme());
  // Même n° de technicien dans les deux applications (table technician partagée).
  const currentUser = await currentUserPromise;
  if (currentUser) {
    embeddedPageUrl.searchParams.set("technician_id", String(currentUser.technicianId));
    embeddedPageUrl.searchParams.set("display_name", currentUser.fullName || currentUser.username);
  }
  openInNewTabLink.href = new URL(COPILOT_PAGE_PATH, chatbotOrigin).href;

  copilotFrame.addEventListener("load", () => {
    loadingPanel.hidden = true;
    copilotFrame.hidden = false;
  });
  copilotFrame.src = embeddedPageUrl.href;

  // Le bouton clair / sombre de la navigation change data-theme sur <html> : on relaie au Copilote.
  new MutationObserver(() => {
    copilotFrame.contentWindow?.postMessage({ type: THEME_MESSAGE_TYPE, theme: readCurrentTheme() }, chatbotOrigin);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
