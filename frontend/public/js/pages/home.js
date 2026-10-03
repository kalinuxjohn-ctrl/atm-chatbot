/**
 * Page d'accueil : personnages animés + connexion au Copilote.
 * La connexion est simulée (voir services/api/authApi.js).
 */

import { renderAvatar } from "../components/avatar.js";
import { getFriendlyErrorMessage } from "../core/httpClient.js";
import { getSession, login } from "../services/sessionService.js";
import { prefersReducedMotion } from "../utils/dom.js";

const COPILOT_URL = "/copilot.html";

const loginDialog = document.querySelector("#login-dialog");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const loginSubmit = document.querySelector("#login-submit");
const accessButtons = document.querySelectorAll("[data-open-copilot]");

/* ---------- Personnages de la scène ---------- */
document.querySelectorAll("[data-character]").forEach((slot) => {
  slot.replaceChildren(renderAvatar(slot.dataset.character));
});

/* ---------- Transition vers le Copilote ---------- */
function goToCopilot() {
  if (prefersReducedMotion()) {
    window.location.href = COPILOT_URL;
    return;
  }
  document.body.classList.add("is-leaving"); // déclenche le voile animé (home.css)
  setTimeout(() => (window.location.href = COPILOT_URL), 450);
}

/* ---------- Boutons d'accès : reprise directe si déjà connecté ---------- */
const session = getSession();
accessButtons.forEach((button) => {
  if (session) button.querySelector("[data-label]").textContent = `Reprendre en tant que ${session.displayName}`;
  button.addEventListener("click", () => (getSession() ? goToCopilot() : loginDialog.showModal()));
});

/* ---------- Connexion ---------- */
loginForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return; // le bouton Annuler ferme simplement le dialogue
  event.preventDefault();
  loginError.hidden = true;
  loginSubmit.disabled = true;

  const data = new FormData(loginForm);
  try {
    await login({
      technicianId: Number(data.get("technicianId")),
      displayName: String(data.get("displayName") || ""),
    });
    loginDialog.close();
    goToCopilot();
  } catch (error) {
    loginError.textContent = getFriendlyErrorMessage(error);
    loginError.hidden = false;
  } finally {
    loginSubmit.disabled = false;
  }
});

// Arrivée depuis une page protégée sans session (/?login=1) : on ouvre directement la connexion.
if (!session && new URLSearchParams(window.location.search).has("login")) {
  loginDialog.showModal();
}
