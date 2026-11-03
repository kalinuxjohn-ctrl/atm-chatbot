/**
 * Onglet Copilote : affiche le chatbot dans une iframe, sous la navigation de
 * l'Espace techniciens.
 *
 * Le chatbot est servi par le gateway sous /copilot/app/ (même site, même
 * cookie de session) : le gateway vérifie la session et transmet le technicien
 * connecté à l'API du chatbot, qui ne croit que cette information.
 *
 * L'adresse chargée est /copilot/app/copilot.html?embedded=1&theme=…&technician_id=…&display_name=… :
 * en mode « embedded » (frontend/public/js/embeddedMode.js), le chatbot masque
 * sa barre du haut et affiche le nom du technicien sans lui redemander qui il est.
 * Quand l'utilisateur change de thème ici, l'iframe est prévenue (postMessage).
 */

import { currentUserPromise } from "/shared/js/connectedPageShell.js";

const COPILOT_PAGE_PATH = "/copilot/app/copilot.html";
// Même valeur que THEME_MESSAGE_TYPE dans frontend/public/js/embeddedMode.js (chatbot).
const THEME_MESSAGE_TYPE = "espace-techniciens:theme";

const copilotFrame = document.querySelector("[data-copilot-frame]");
const loadingPanel = document.querySelector("[data-copilot-loading]");

const readCurrentTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

const embeddedPageParameters = new URLSearchParams({ embedded: "1", theme: readCurrentTheme() });
const currentUser = await currentUserPromise;
if (currentUser) {
  embeddedPageParameters.set("technician_id", String(currentUser.technicianId));
  embeddedPageParameters.set("display_name", currentUser.fullName || currentUser.username);
}

copilotFrame.addEventListener("load", () => {
  loadingPanel.hidden = true;
  copilotFrame.hidden = false;
});
copilotFrame.src = `${COPILOT_PAGE_PATH}?${embeddedPageParameters}`;

// Le bouton clair / sombre de la navigation change data-theme sur <html> : on relaie au Copilote.
new MutationObserver(() => {
  copilotFrame.contentWindow?.postMessage({ type: THEME_MESSAGE_TYPE, theme: readCurrentTheme() }, window.location.origin);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
