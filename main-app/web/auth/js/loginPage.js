/**
 * Page de connexion. Après connexion, retour à la page demandée (?next=),
 * seulement si c'est un chemin de CE site : sinon un lien piégé
 * (?next=https://site-pirate) enverrait l'utilisateur ailleurs (open redirect).
 */

import { findSafeLoginRedirectPath, requestJson } from "/shared/js/apiClient.js";

const loginForm = document.querySelector("[data-login-form]");
const formError = document.querySelector("[data-form-error]");

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

loginForm.addEventListener("submit", async (submitEvent) => {
  submitEvent.preventDefault();
  showError("");
  const username = loginForm.elements.username.value.trim();
  const password = loginForm.elements.password.value;
  if (!username || !password) {
    showError("Saisissez votre nom d'utilisateur et votre mot de passe.");
    return;
  }
  const submitButton = loginForm.querySelector("[type=submit]");
  submitButton.disabled = true;
  try {
    const { user } = await requestJson("/api/auth/login", { method: "POST", body: { username, password } });
    const requestedPath = new URLSearchParams(window.location.search).get("next");
    window.location.assign(findSafeLoginRedirectPath(requestedPath, user.role, window.location.origin));
  } catch (error) {
    showError(error.message);
    loginForm.elements.password.value = "";
    loginForm.elements.password.focus();
  } finally {
    submitButton.disabled = false;
  }
});

// Lien « Créer un compte » seulement si l'inscription libre est ouverte.
requestJson("/api/auth/registration")
  .then(({ registrationAllowed }) => {
    document.querySelector("[data-registration-link]").hidden = !registrationAllowed;
  })
  .catch(() => {});
