/**
 * Inscription libre, si MAIN_APP_ALLOW_REGISTRATION=true (fermée par défaut).
 * Le backend revérifie tout : ces contrôles ne servent qu'au confort.
 */

import { requestJson } from "/shared/js/apiClient.js";

const registrationForm = document.querySelector("[data-registration-form]");
const registrationClosedNotice = document.querySelector("[data-registration-closed]");
const formError = document.querySelector("[data-form-error]");

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

async function showFormIfRegistrationIsOpen() {
  try {
    const { registrationAllowed } = await requestJson("/api/auth/registration");
    registrationForm.hidden = !registrationAllowed;
    registrationClosedNotice.hidden = registrationAllowed;
  } catch {
    registrationClosedNotice.hidden = false;
  }
}

registrationForm.addEventListener("submit", async (submitEvent) => {
  submitEvent.preventDefault();
  showError("");
  const fields = registrationForm.elements;
  if (!fields.username.checkValidity()) {
    showError("Nom d'utilisateur : 3 à 30 caractères, lettres sans accent, chiffres, _ . -");
    return;
  }
  if (fields.password.value.length < 10) {
    showError("Le mot de passe doit faire au moins 10 caractères.");
    return;
  }
  if (fields.password.value !== fields.passwordConfirmation.value) {
    showError("Les deux mots de passe sont différents.");
    return;
  }
  const submitButton = registrationForm.querySelector("[type=submit]");
  submitButton.disabled = true;
  try {
    await requestJson("/api/auth/register", {
      method: "POST",
      body: {
        username: fields.username.value.trim(),
        password: fields.password.value,
        ...(fields.fullName.value.trim() ? { fullName: fields.fullName.value.trim() } : {}),
      },
    });
    window.location.assign("/");
  } catch (error) {
    showError(error.message);
  } finally {
    submitButton.disabled = false;
  }
});

showFormIfRegistrationIsOpen();
