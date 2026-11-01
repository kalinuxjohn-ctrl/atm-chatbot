/**
 * Gestion des comptes : création (par un admin, par inscription libre, par
 * le job create-admin), rôles, activation, réinitialisation du mot de passe.
 *
 * Il n'y a pas d'email : un mot de passe oublié est réinitialisé par un
 * administrateur, qui le transmet au technicien par un autre canal.
 */

import { runInTransaction } from "../../core/database.js";
import { ReferenceNotFoundError, StateConflictError } from "../../core/errors.js";
import { deleteSessionsOfTechnician } from "../../core/sessionStore.js";
import { trace } from "../../core/tracing.js";
import {
  countActiveAdministrators,
  findAccountByTechnicianId,
  findAllAccounts,
  findTechnicianWithAccountState,
  insertAccount,
  insertMinimalTechnician,
  updateAccountActiveState,
  updateAccountPasswordHash,
  updateAccountRole,
  usernameIsTaken,
} from "../../models/auth/accountModel.js";
import { hashPassword } from "./passwordHashingService.js";

const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * Crée le compte, et si besoin la ligne minimale de public.technician, en UNE
 * transaction : pas de technicien orphelin si le nom d'utilisateur est déjà pris.
 * Renvoie le technician_id du compte créé.
 */
export async function createAccount({ username, password, role, existingTechnicianId = undefined, fullName = undefined }) {
  // Hachage AVANT la transaction : argon2 prend ~50 ms, inutile de garder une connexion ouverte pendant ce temps.
  const passwordHash = await hashPassword(password);
  try {
    const technicianId = await runInTransaction(async (databaseClient) => {
      if (await usernameIsTaken(username, databaseClient)) {
        throw new StateConflictError("Ce nom d'utilisateur est déjà pris.");
      }
      let accountTechnicianId = existingTechnicianId;
      if (accountTechnicianId !== undefined) {
        const technician = await findTechnicianWithAccountState(accountTechnicianId, databaseClient);
        if (!technician) {
          throw new ReferenceNotFoundError(`Technicien ${accountTechnicianId} introuvable.`);
        }
        if (technician.hasAccount) {
          throw new StateConflictError("Ce technicien a déjà un compte.");
        }
      } else {
        accountTechnicianId = await insertMinimalTechnician(fullName ?? username, databaseClient);
      }
      await insertAccount({ technicianId: accountTechnicianId, username, passwordHash, role }, databaseClient);
      return accountTechnicianId;
    });
    trace("AUTH", "Compte créé", { technicianId, role, linkedToExistingTechnician: existingTechnicianId !== undefined });
    return technicianId;
  } catch (error) {
    // Deux créations simultanées du même nom : la contrainte UNIQUE tranche.
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      throw new StateConflictError("Ce nom d'utilisateur ou ce technicien a déjà un compte.");
    }
    throw error;
  }
}

export async function listAccounts() {
  return findAllAccounts();
}

export async function findAccount(technicianId) {
  return findAccountOrFail(technicianId);
}

async function findAccountOrFail(technicianId) {
  const account = await findAccountByTechnicianId(technicianId);
  if (!account) {
    throw new ReferenceNotFoundError("Compte introuvable.");
  }
  return account;
}

/** Un administrateur ne modifie pas son propre compte : il ne peut pas se retirer ses droits par erreur. */
function refuseActionOnOwnAccount(actingUser, technicianId) {
  if (actingUser.technicianId === technicianId) {
    throw new StateConflictError("Vous ne pouvez pas modifier votre propre compte depuis l'administration.");
  }
}

/** Il doit toujours rester au moins un administrateur actif, sinon plus personne ne gère les comptes. */
async function refuseRemovingLastAdministrator(account) {
  if (account.role === "admin" && account.isActive && (await countActiveAdministrators()) <= 1) {
    throw new StateConflictError("Impossible : c'est le dernier administrateur actif.");
  }
}

export async function changeAccountRole(actingUser, technicianId, newRole) {
  refuseActionOnOwnAccount(actingUser, technicianId);
  const account = await findAccountOrFail(technicianId);
  if (newRole !== "admin") {
    await refuseRemovingLastAdministrator(account);
  }
  await updateAccountRole(technicianId, newRole);
  trace("AUTH", "Rôle modifié", { technicianId, newRole, changedBy: actingUser.technicianId });
  return findAccountOrFail(technicianId);
}

export async function changeAccountActiveState(actingUser, technicianId, isActive) {
  refuseActionOnOwnAccount(actingUser, technicianId);
  const account = await findAccountOrFail(technicianId);
  if (!isActive) {
    await refuseRemovingLastAdministrator(account);
  }
  await runInTransaction(async (databaseClient) => {
    await updateAccountActiveState(technicianId, isActive, databaseClient);
    // Désactivé = déconnecté tout de suite, sur tous ses appareils.
    if (!isActive) {
      await deleteSessionsOfTechnician(technicianId, {}, databaseClient);
    }
  });
  trace("AUTH", isActive ? "Compte réactivé" : "Compte désactivé", { technicianId, changedBy: actingUser.technicianId });
  return findAccountOrFail(technicianId);
}

/** Réinitialisation par un administrateur : toutes les sessions du compte sont fermées. */
export async function resetAccountPassword(actingUser, technicianId, newPassword) {
  await findAccountOrFail(technicianId);
  const passwordHash = await hashPassword(newPassword);
  await runInTransaction(async (databaseClient) => {
    await updateAccountPasswordHash(technicianId, passwordHash, databaseClient);
    await deleteSessionsOfTechnician(technicianId, {}, databaseClient);
  });
  trace("AUTH", "Mot de passe réinitialisé", { technicianId, resetBy: actingUser?.technicianId ?? "job" });
}
