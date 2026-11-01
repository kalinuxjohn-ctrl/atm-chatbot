/**
 * Administration des comptes (rôle admin). Le backend vérifie le rôle à
 * chaque requête : cette page ne fait qu'afficher et envoyer.
 * Noms et noms d'utilisateur insérés avec textContent (createElementWithText).
 */

import { requestJson } from "/shared/js/apiClient.js";
import { currentUserPromise } from "/shared/js/connectedPageShell.js";
import { createButton, createElementWithText } from "/shared/js/domHelpers.js";

const ROLE_LABELS = { technician: "Technicien", moderator: "Modérateur", admin: "Administrateur" };

const pageError = document.querySelector("[data-page-error]");
const accountsTableBody = document.querySelector("[data-accounts-table-body]");
const creationForm = document.querySelector("[data-account-creation-form]");
const creationError = document.querySelector("[data-creation-error]");
const creationSuccess = document.querySelector("[data-creation-success]");

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

/** Formulaire et tableau visibles seulement si le serveur a accepté de lister les comptes (rôle admin). */
function showAdministratorSections(isVisible) {
  for (const administratorSection of document.querySelectorAll("[data-administrator-only]")) {
    administratorSection.hidden = !isVisible;
  }
}

async function runAndReportError(action) {
  showMessage(pageError, "");
  try {
    await action();
  } catch (error) {
    showMessage(pageError, error.message);
  }
  await reloadAccounts();
}

function createRoleSelector(account, isOwnAccount) {
  const roleSelector = document.createElement("select");
  roleSelector.setAttribute("aria-label", `Rôle de ${account.username}`);
  for (const [roleValue, roleLabel] of Object.entries(ROLE_LABELS)) {
    roleSelector.add(new Option(roleLabel, roleValue, false, roleValue === account.role));
  }
  roleSelector.disabled = isOwnAccount;
  roleSelector.addEventListener("change", () =>
    runAndReportError(() =>
      requestJson(`/api/auth/accounts/${account.technicianId}/role`, { method: "PUT", body: { role: roleSelector.value } }),
    ),
  );
  return roleSelector;
}

function createAccountActions(account, isOwnAccount) {
  const actions = createElementWithText("div", "account-actions");
  if (isOwnAccount) {
    actions.append(createElementWithText("span", "muted", "Votre compte"));
    return actions;
  }
  actions.append(
    createButton(account.isActive ? "Désactiver" : "Réactiver", {
      className: "button button-secondary",
      onClick: () =>
        runAndReportError(() =>
          requestJson(`/api/auth/accounts/${account.technicianId}/active`, { method: "PUT", body: { isActive: !account.isActive } }),
        ),
    }),
    createButton("Nouveau mot de passe", {
      className: "button button-secondary",
      onClick: () => {
        // prompt() natif : champ texte simple, la valeur ne s'affiche nulle part dans la page.
        const newPassword = window.prompt(`Nouveau mot de passe pour ${account.username} (10 caractères minimum) :`);
        if (newPassword) {
          runAndReportError(() =>
            requestJson(`/api/auth/accounts/${account.technicianId}/password`, { method: "PUT", body: { newPassword } }),
          );
        }
      },
    }),
  );
  return actions;
}

async function reloadAccounts() {
  const currentUser = await currentUserPromise;
  let accounts;
  try {
    ({ accounts } = await requestJson("/api/auth/accounts"));
  } catch (error) {
    showMessage(pageError, error.httpStatus === 403 ? "Page réservée aux administrateurs." : error.message);
    accountsTableBody.replaceChildren();
    showAdministratorSections(false);
    return;
  }
  showAdministratorSections(true);
  accountsTableBody.replaceChildren(
    ...accounts.map((account) => {
      const isOwnAccount = currentUser?.technicianId === account.technicianId;
      const tableRow = createElementWithText("tr", account.isActive ? "" : "account-inactive");
      const roleCell = document.createElement("td");
      roleCell.append(createRoleSelector(account, isOwnAccount));
      const actionsCell = document.createElement("td");
      actionsCell.append(createAccountActions(account, isOwnAccount));
      tableRow.append(
        createElementWithText("td", "", account.username),
        createElementWithText("td", "", account.fullName ?? ""),
        createElementWithText("td", "", String(account.technicianId)),
        roleCell,
        createElementWithText("td", "", account.isActive ? "Actif" : "Désactivé"),
        actionsCell,
      );
      return tableRow;
    }),
  );
}

creationForm.addEventListener("submit", async (submitEvent) => {
  submitEvent.preventDefault();
  showMessage(creationError, "");
  showMessage(creationSuccess, "");
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
    showMessage(creationSuccess, `Compte « ${account.username} » créé.`);
    creationForm.reset();
    await reloadAccounts();
  } catch (error) {
    showMessage(creationError, error.message);
  }
});

reloadAccounts();
