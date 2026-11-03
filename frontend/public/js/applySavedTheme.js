/**
 * Thème sombre appliqué AVANT l'affichage (clé STORAGE_KEYS.theme de config.js),
 * pour éviter un éclair blanc. Script classique chargé en tête de chaque page.
 * Fichier séparé (et non script en ligne) : derrière l'Espace techniciens, la
 * politique de sécurité (CSP) refuse les scripts écrits dans le HTML.
 */
try {
  if (localStorage.getItem("atm-chatbot.theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
} catch (storageError) {
  // Stockage indisponible : thème clair.
}
