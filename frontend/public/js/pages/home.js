/**
 * Page d'accueil et connexion à l’ATM-Chatbot.
 * La connexion est simulée (voir services/api/authApi.js).
 */

import { getFriendlyErrorMessage } from "../core/httpClient.js";
import { getSession, login } from "../services/sessionService.js";
import { prefersReducedMotion } from "../utils/dom.js";

const ATM_CHATBOT_URL = "atm-chatbot.html";

const loginDialog = document.querySelector("#login-dialog");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const loginSubmit = document.querySelector("#login-submit");
const accessButtons = document.querySelectorAll("[data-open-atm-chatbot]");

/* ---------- Transition vers l’ATM-Chatbot ---------- */
function goToAtmChatbot() {
  if (prefersReducedMotion()) {
    window.location.href = ATM_CHATBOT_URL;
    return;
  }
  document.body.classList.add("is-leaving"); // déclenche le voile animé (home.css)
  setTimeout(() => (window.location.href = ATM_CHATBOT_URL), 450);
}

/* ---------- Boutons d'accès : reprise directe si déjà connecté ---------- */
const session = getSession();
accessButtons.forEach((button) => {
  if (session && button.closest(".site-header, .home-final-cta")) {
    button.querySelector("[data-label]").textContent = `Reprendre en tant que ${session.displayName}`;
  }
  button.addEventListener("click", () => (getSession() ? goToAtmChatbot() : loginDialog.showModal()));
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
    goToAtmChatbot();
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
