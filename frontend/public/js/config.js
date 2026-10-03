/**
 * Configuration centrale du frontend.
 * Toute valeur "réglable" vit ici : aucun autre fichier ne doit coder en dur
 * une URL, une clé de stockage ou un délai.
 */

// Le serveur frontend (server.py) relaie /api/* vers le backend FastAPI.
export const API_BASE_URL = "/api";

// Le backend appelle un LLM (le premier appel charge le modèle : parfois > 1 min).
// Doit rester un peu supérieur au délai du proxy (PROXY_TIMEOUT_SECONDS de server.py).
export const REQUEST_TIMEOUT_MS = 185000;

// Langue utilisée pour la reconnaissance et la synthèse vocale.
export const SPEECH_LANG = "fr-FR";

export const STORAGE_KEYS = Object.freeze({
  preferences: "copilot.preferences", // localStorage : conservé entre les sessions
  session: "copilot.session", // localStorage : technicien connecté
  conversation: "copilot.conversation", // sessionStorage : conversation de l'onglet
  forceMocks: "copilot.forceMocks", // sessionStorage : mode démo
});

/**
 * Mode démo : ajouter ?mock=1 à l'URL fait passer TOUTES les API par leurs
 * mocks (utile sans backend). ?mock=0 le désactive. Le choix est mémorisé
 * pour l'onglet, afin de survivre à la navigation entre les pages.
 */
function resolveMockMode() {
  const flag = new URLSearchParams(window.location.search).get("mock");
  if (flag === "1") sessionStorage.setItem(STORAGE_KEYS.forceMocks, "1");
  if (flag === "0") sessionStorage.removeItem(STORAGE_KEYS.forceMocks);
  return sessionStorage.getItem(STORAGE_KEYS.forceMocks) === "1";
}

export const FORCE_MOCKS = resolveMockMode();
