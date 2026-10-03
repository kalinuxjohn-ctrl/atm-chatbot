/**
 * Sidebar rétractable de la page Copilote.
 *
 *   ≥ 1100 px  : visible, large par défaut ; réductible en barre d'icônes
 *   720-1099 px : compacte (icônes) par défaut ; extensible
 *   < 720 px   : cachée, s'ouvre en tiroir par-dessus la conversation
 *
 * L'état est posé sur l'élément racine :
 *   data-sidebar="expanded" | "collapsed"   (grands écrans)
 *   data-sidebar-drawer="open" | "closed"   (petits écrans)
 * Le CSS adapte automatiquement la largeur du contenu principal.
 * Le choix réduit/étendu du technicien est mémorisé (préférence sidebarCollapsed).
 */

import { getPreferences, updatePreferences } from "../services/preferencesService.js";
import { setIcon } from "./icons.js";

const DESKTOP_QUERY = window.matchMedia("(min-width: 1100px)");
const MOBILE_QUERY = window.matchMedia("(max-width: 719px)");

export function createSidebar({ shell, sidebar, collapseButton, openButtons, backdrop }) {
  const collapseIcon = collapseButton.querySelector("[data-icon]");
  let lastOpener = null;

  const isMobile = () => MOBILE_QUERY.matches;

  function isCollapsed() {
    const { sidebarCollapsed } = getPreferences();
    if (sidebarCollapsed === null || sidebarCollapsed === undefined) return !DESKTOP_QUERY.matches;
    return sidebarCollapsed;
  }

  function render() {
    const collapsed = isCollapsed();
    shell.dataset.sidebar = collapsed ? "collapsed" : "expanded";

    if (isMobile()) {
      const open = shell.dataset.sidebarDrawer === "open";
      sidebar.inert = !open;
      collapseButton.setAttribute("aria-label", "Fermer le menu");
      collapseButton.setAttribute("aria-expanded", String(open));
      setIcon(collapseIcon, "close");
    } else {
      shell.dataset.sidebarDrawer = "closed";
      sidebar.inert = false;
      collapseButton.setAttribute("aria-label", collapsed ? "Agrandir le menu" : "Réduire le menu");
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
      setIcon(collapseIcon, collapsed ? "expand" : "collapse");
    }
    // En mode icônes, le libellé de chaque lien devient une info-bulle.
    sidebar.querySelectorAll("[data-sidebar-label]").forEach((element) => {
      if (collapsed && !isMobile()) element.title = element.dataset.sidebarLabel;
      else element.removeAttribute("title");
    });
  }

  function openDrawer(opener) {
    lastOpener = opener ?? null;
    shell.dataset.sidebarDrawer = "open";
    render();
    sidebar.querySelector("a, button")?.focus();
  }

  function closeDrawer() {
    if (shell.dataset.sidebarDrawer !== "open") return;
    shell.dataset.sidebarDrawer = "closed";
    render();
    lastOpener?.focus();
  }

  collapseButton.addEventListener("click", () => {
    if (isMobile()) closeDrawer();
    else {
      updatePreferences({ sidebarCollapsed: !isCollapsed() });
      render();
    }
  });
  openButtons.forEach((button) => button.addEventListener("click", () => openDrawer(button)));
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isMobile()) closeDrawer();
  });
  // Sur mobile, choisir une action du menu referme le tiroir.
  sidebar.addEventListener("click", (event) => {
    if (isMobile() && event.target.closest("[data-closes-drawer]")) closeDrawer();
  });
  DESKTOP_QUERY.addEventListener("change", render);
  MOBILE_QUERY.addEventListener("change", render);

  shell.dataset.sidebarDrawer = "closed";
  render();

  return { closeDrawer };
}
