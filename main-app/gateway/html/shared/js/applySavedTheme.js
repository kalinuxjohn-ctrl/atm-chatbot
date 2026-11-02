/*
 * Thème clair / sombre, appliqué AVANT le premier affichage.
 *
 * Script classique (pas un module) chargé dans <head> sans defer : il pose
 * <html data-theme> avant que la page ne s'affiche, sinon elle clignoterait
 * en clair avant de passer en sombre.
 *
 * Choix mémorisé par connectedPageShell.js (bouton soleil | lune) ; sans
 * choix, on suit le réglage du système. Le stockage peut être refusé
 * (navigation privée) : on retombe alors sur le réglage du système.
 */
(() => {
  const readSavedTheme = () => {
    try {
      return window.localStorage.getItem("main-app-theme");
    } catch {
      return null;
    }
  };
  const savedTheme = readSavedTheme();
  const systemPrefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme = savedTheme === "dark" || savedTheme === "light" ? savedTheme : systemPrefersDark ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();
