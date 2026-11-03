/**
 * Mode « intégré » du Copilote : quand la page est affichée dans l'onglet
 * Copilote de l'Espace techniciens (main app, iframe), l'adresse contient :
 *
 *   ?embedded=1                 masque la barre du haut (l'Espace techniciens a déjà sa navigation)
 *   &theme=dark|light           thème de l'Espace techniciens
 *   &technician_id=7            technicien connecté à l'Espace techniciens
 *   &display_name=Alan%20Test   son nom
 *
 * Script CLASSIQUE (pas un module), chargé dans le <head> AVANT les modules :
 * la session doit exister quand copilot.js vérifie la connexion (requireSession),
 * et le thème doit être posé avant l'affichage.
 *
 * Ensuite, l'Espace techniciens prévient la page quand l'utilisateur change de
 * thème (postMessage { type: "espace-techniciens:theme", theme }).
 */
(function applyEmbeddedMode() {
  var THEME_MESSAGE_TYPE = "espace-techniciens:theme";
  var SESSION_STORAGE_KEY = "copilot.session"; // STORAGE_KEYS.session de config.js
  var CONVERSATION_STORAGE_KEY = "copilot.conversation"; // STORAGE_KEYS.conversation de config.js

  var parameters = new URLSearchParams(window.location.search);
  if (parameters.get("embedded") !== "1") {
    return;
  }
  var rootElement = document.documentElement;
  rootElement.dataset.embedded = "";

  function applyTheme(theme) {
    if (theme === "dark") {
      rootElement.dataset.theme = "dark";
    } else if (theme === "light") {
      delete rootElement.dataset.theme;
    }
  }
  applyTheme(parameters.get("theme"));

  // Le technicien de l'Espace techniciens devient celui du Copilote (même n° de technicien en base).
  var technicianId = Number(parameters.get("technician_id"));
  if (Number.isInteger(technicianId) && technicianId > 0) {
    try {
      var previousSession = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
      if (!previousSession || previousSession.technicianId !== technicianId) {
        // Autre technicien qu'avant : sa conversation en cours ne doit pas être reprise.
        sessionStorage.removeItem(CONVERSATION_STORAGE_KEY);
      }
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({ technicianId: technicianId, displayName: parameters.get("display_name") || "Technicien " + technicianId }),
      );
    } catch (storageError) {
      // Stockage refusé : le Copilote demandera la connexion comme d'habitude.
    }
  }

  window.addEventListener("message", function onParentMessage(messageEvent) {
    // Seul le thème est accepté, quelle que soit l'origine : il ne peut rien faire d'autre.
    if (messageEvent.data && messageEvent.data.type === THEME_MESSAGE_TYPE) {
      applyTheme(messageEvent.data.theme);
    }
  });
})();
