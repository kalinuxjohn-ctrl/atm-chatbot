/**
 * Rubrique « Comptes » : comptes de l'Espace techniciens (API du conteneur auth,
 * /api/auth/accounts). Le serveur vérifie le rôle admin à chaque requête :
 * cette rubrique ne fait qu'afficher et envoyer.
 */

import { requestJson } from "/shared/js/apiClient.js";
import { createAvatar, createButton, createElementWithText } from "/shared/js/domHelpers.js";
import { createIcon } from "/shared/js/icons.js";

const ROLE_LABELS = { technician: "Technicien", moderator: "Modérateur", admin: "Administrateur" };

function showMessage(messageElement, message) {
  messageElement.textContent = message;
  messageElement.hidden = !message;
}

/**
 * @param {object} context
 * @param {object|null} context.currentUser
 * @param {(count: number) => void} context.showAccountCount  met à jour le compteur du sommaire
 */
export function createAccountsSection({ currentUser, showAccountCount }) {
  const sectionElement = document.querySelector('[data-section="comptes"]');
  const accountsError = sectionElement.querySelector("[data-accounts-error]");
  const accountsSuccess = sectionElement.querySelector("[data-accounts-success]");
  const accountsTableBody = sectionElement.querySelector("[data-accounts-table-body]");
  const creationForm = sectionElement.querySelector("[data-account-creation-form]");
  const creationError = sectionElement.querySelector("[data-creation-error]");
  const creationToggleButton = sectionElement.querySelector("[data-account-creation-toggle]");

  async function runThenReload(action, successMessage = "") {
    showMessage(accountsError, "");
    showMessage(accountsSuccess, "");
    try {
      await action();
      showMessage(accountsSuccess, successMessage);
    } catch (error) {
      showMessage(accountsError, error.message);
    }
    await loadAccounts();
  }

  function createRoleSelector(account, isOwnAccount) {
    const roleSelector = document.createElement("select");
    roleSelector.className = "compact-select";
    roleSelector.setAttribute("aria-label", `Rôle de ${account.username}`);
    for (const [roleValue, roleLabel] of Object.entries(ROLE_LABELS)) {
      roleSelector.add(new Option(roleLabel, roleValue, false, roleValue === account.role));
    }
    roleSelector.disabled = isOwnAccount; // un admin ne peut pas se retirer lui-même ses droits
    roleSelector.addEventListener("change", () =>
      runThenReload(
        () => requestJson(`/api/auth/accounts/${account.technicianId}/role`, { method: "PUT", body: { role: roleSelector.value } }),
        `Rôle de « ${account.username} » : ${ROLE_LABELS[roleSelector.value]}.`,
      ),
    );
    return roleSelector;
  }

  /** Petit formulaire en ligne pour un nouveau mot de passe (remplace les actions le temps de la saisie). */
  function showPasswordResetForm(actionsContainer, account) {
    const passwordForm = createElementWithText("form", "inline-password-form");
    const passwordInput = document.createElement("input");
    passwordInput.type = "password";
    passwordInput.minLength = 10;
    passwordInput.maxLength = 128;
    passwordInput.autocomplete = "new-password";
    passwordInput.placeholder = "Nouveau mot de passe (10 car. min.)";
    passwordInput.setAttribute("aria-label", `Nouveau mot de passe pour ${account.username}`);
    const cancelButton = createButton("Annuler", { className: "button button-secondary button-small", onClick: () => loadAccounts() });
    const saveButton = createButton("Enregistrer", { className: "button button-small", type: "submit" });
    passwordForm.append(passwordInput, cancelButton, saveButton);
    passwordForm.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      runThenReload(
        () => requestJson(`/api/auth/accounts/${account.technicianId}/password`, { method: "PUT", body: { newPassword: passwordInput.value } }),
        `Mot de passe de « ${account.username} » changé : ses sessions ont été fermées.`,
      );
    });
    actionsContainer.replaceChildren(passwordForm);
    passwordInput.focus();
  }

  function createAccountActions(account, isOwnAccount) {
    const actionsContainer = createElementWithText("div", "row-actions");
    if (isOwnAccount) {
      actionsContainer.append(createElementWithText("span", "badge badge-accent", "Votre compte"));
      return actionsContainer;
    }
    const activationButton = createElementWithText("button", "button button-secondary button-small");
    activationButton.type = "button";
    activationButton.append(createIcon(account.isActive ? "close" : "check"), createElementWithText("span", "", account.isActive ? "Désactiver" : "Réactiver"));
    activationButton.addEventListener("click", () =>
      runThenReload(
        () => requestJson(`/api/auth/accounts/${account.technicianId}/active`, { method: "PUT", body: { isActive: !account.isActive } }),
        account.isActive ? `« ${account.username} » désactivé : ses sessions ont été coupées.` : `« ${account.username} » réactivé.`,
      ),
    );
    const passwordButton = createElementWithText("button", "button button-secondary button-small");
    passwordButton.type = "button";
    passwordButton.append(createIcon("key"), createElementWithText("span", "", "Mot de passe"));
    passwordButton.addEventListener("click", () => showPasswordResetForm(actionsContainer, account));
    actionsContainer.append(activationButton, passwordButton);
    return actionsContainer;
  }

  function createAccountRow(account) {
    const isOwnAccount = currentUser?.technicianId === account.technicianId;
    const tableRow = createElementWithText("tr", account.isActive ? "" : "is-inactive");

    const userCell = createElementWithText("td");
    const userIdentity = createElementWithText("div", "user-identity");
    const userNames = createElementWithText("div", "user-identity-names");
    userNames.append(createElementWithText("strong", "", account.username), createElementWithText("span", "muted", account.fullName ?? ""));
    userIdentity.append(createAvatar(account.username, { sizeClassName: "avatar-small" }), userNames);
    userCell.append(userIdentity);

    const roleCell = createElementWithText("td");
    roleCell.append(createRoleSelector(account, isOwnAccount));
    const stateCell = createElementWithText("td");
    stateCell.append(createElementWithText("span", account.isActive ? "badge badge-accent" : "badge badge-danger", account.isActive ? "Actif" : "Désactivé"));
    const actionsCell = createElementWithText("td", "data-table-actions");
    actionsCell.append(createAccountActions(account, isOwnAccount));

    tableRow.append(userCell, createElementWithText("td", "muted", `n° ${account.technicianId}`), roleCell, stateCell, actionsCell);
    return tableRow;
  }

  async function loadAccounts() {
    try {
      const { accounts } = await requestJson("/api/auth/accounts");
      showAccountCount(accounts.length);
      accountsTableBody.replaceChildren(...accounts.map(createAccountRow));
    } catch (error) {
      showMessage(accountsError, error.message);
    }
  }

  function setCreationFormVisible(isVisible) {
    creationForm.hidden = !isVisible;
    creationToggleButton.hidden = isVisible;
    if (isVisible) {
      creationForm.elements.username.focus();
    } else {
      creationForm.reset();
      showMessage(creationError, "");
    }
  }

  creationToggleButton.addEventListener("click", () => setCreationFormVisible(true));
  sectionElement.querySelector("[data-account-creation-cancel]").addEventListener("click", () => setCreationFormVisible(false));

  creationForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    showMessage(creationError, "");
    const fields = creationForm.elements;
    const existingTechnicianIdText = fields.existingTechnicianId.value.trim();
    const accountRequest = {
      username: fields.username.value.trim(),
      password: fields.password.value,
      role: fields.role.value,
      ...(existingTechnicianIdText ? { existingTechnicianId: Number(existingTechnicianIdText) } : {}),
      ...(fields.fullName.value.trim() ? { fullName: fields.fullName.value.trim() } : {}),
    };
    try {
      const { account } = await requestJson("/api/auth/accounts", { method: "POST", body: accountRequest });
      setCreationFormVisible(false);
      showMessage(accountsSuccess, `Compte « ${account.username} » créé.`);
      await loadAccounts();
    } catch (error) {
      showMessage(creationError, error.message);
    }
  });

  return { load: loadAccounts };
}
