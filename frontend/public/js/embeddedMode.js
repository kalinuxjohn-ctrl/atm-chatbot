/**
 * Mode « intégré » de l’ATM-Chatbot : quand la page est affichée dans l'onglet
 * ATM-Chatbot de l'Espace techniciens (main app, iframe sur /atm-chatbot/app/), l'adresse contient :
 *
 *   ?embedded=1                 masque la barre du haut (l'Espace techniciens a déjà sa navigation)
 *   &theme=dark|light|gab       thème de l'Espace techniciens
 *   &technician_id=7            technicien connecté à l'Espace techniciens
 *   &display_name=Alan%20Test   son nom
 *
 * Le technicien sert à l'AFFICHAGE et à passer l'écran de connexion simulée :
 * derrière l'Espace techniciens, l'API du chatbot ignore le n° envoyé par la page
 * et utilise celui de la session, transmis par le gateway (app/core/gateway_identity.py).
 *
 * Script CLASSIQUE (pas un module), chargé dans le <head> AVANT les modules :
 * la session doit exister quand atm-chatbot.js vérifie la connexion (requireSession),
 * et le thème doit être posé avant l'affichage.
 *
 * Ensuite, l'Espace techniciens prévient la page quand l'utilisateur change de
 * thème (postMessage { type: "espace-techniciens:theme", theme }).
 */
(function applyEmbeddedMode() {
  var THEME_MESSAGE_TYPE = "espace-techniciens:theme";
  var SESSION_STORAGE_KEY = "atm-chatbot.session"; // STORAGE_KEYS.session de config.js
  var CONVERSATION_STORAGE_KEY = "atm-chatbot.conversation"; // STORAGE_KEYS.conversation de config.js

  var parameters = new URLSearchParams(window.location.search);
  if (parameters.get("embedded") !== "1") {
    return;
  }
  var rootElement = document.documentElement;
  rootElement.dataset.embedded = "";

  function applyTheme(theme) {
    if (theme === "dark" || theme === "gab") {
      rootElement.dataset.theme = theme;
    } else if (theme === "light") {
      delete rootElement.dataset.theme;
    }
  }
  applyTheme(parameters.get("theme"));

  // Le technicien de l'Espace techniciens devient celui de l’ATM-Chatbot (même n° de technicien en base).
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
      // Stockage refusé : l’ATM-Chatbot demandera la connexion comme d'habitude.
    }
  }

  window.addEventListener("message", function onParentMessage(messageEvent) {
    // Seule la page de l'Espace techniciens qui contient l'iframe (même site) est écoutée.
    if (messageEvent.origin !== window.location.origin || messageEvent.source !== window.parent) {
      return;
    }
    if (messageEvent.data && messageEvent.data.type === THEME_MESSAGE_TYPE) {
      applyTheme(messageEvent.data.theme);
    }
  });
})();
