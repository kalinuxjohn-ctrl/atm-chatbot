/**
 * Panneau "Contexte" à droite de la conversation.
 *
 *   ≥ 1280 px : colonne visible à côté du chat (masquable)
 *   < 1280 px : tiroir qui glisse par-dessus, fermé par défaut
 *
 * N'affiche que des informations RÉELLES : équipement choisi, numéro de
 * conversation renvoyé par POST /api/chat, nombre de messages, voix utilisée.
 * État sur l'élément racine : data-context-panel="open" | "closed".
 */

const WIDE_QUERY = window.matchMedia("(min-width: 1280px)");

export function createContextPanel({ shell, panel, toggleButtons, closeButton, backdrop }) {
  const fields = {};
  panel.querySelectorAll("[data-context]").forEach((element) => (fields[element.dataset.context] = element));
  let lastOpener = null;

  function setOpen(open, opener) {
    shell.dataset.contextPanel = open ? "open" : "closed";
    toggleButtons.forEach((button) => button.setAttribute("aria-expanded", String(open)));
    // En tiroir fermé, le panneau sort de l'ordre de tabulation.
    panel.inert = !open;
    if (open && !WIDE_QUERY.matches) {
      lastOpener = opener ?? null;
      closeButton.focus();
    } else if (!open && lastOpener) {
      lastOpener.focus();
      lastOpener = null;
    }
  }

  const isOpen = () => shell.dataset.contextPanel === "open";

  toggleButtons.forEach((button) => button.addEventListener("click", () => setOpen(!isOpen(), button)));
  closeButton.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen() && !WIDE_QUERY.matches && !document.querySelector("dialog[open]")) setOpen(false);
  });
  WIDE_QUERY.addEventListener("change", () => setOpen(WIDE_QUERY.matches));

  setOpen(WIDE_QUERY.matches);

  return {
    /** Met à jour les valeurs affichées : clés = attributs data-context du HTML. */
    update(values) {
      Object.entries(values).forEach(([key, value]) => {
        if (fields[key]) fields[key].textContent = value;
      });
    },
  };
}
