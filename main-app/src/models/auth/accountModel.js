/**
 * Accès SQL aux comptes (main_app.accounts) et à la table d'identité
 * partagée public.technician.
 *
 * Sur public.technician (table du chatbot) : SELECT, et INSERT d'une ligne
 * minimale à la création d'un compte. JAMAIS d'UPDATE ni de DELETE : le
 * rôle SQL main_app_user n'en a d'ailleurs pas le droit (migration 0014).
 */

import { queryDatabase } from "../../core/database.js";

const ACCOUNT_COLUMNS = `
  accounts.technician_id, accounts.username, accounts.role, accounts.is_active,
  accounts.last_login_at, accounts.created_at, technicians.full_name`;

function toAccount(accountRow) {
  return {
    technicianId: accountRow.technician_id,
    username: accountRow.username,
    role: accountRow.role,
    isActive: accountRow.is_active,
    fullName: accountRow.full_name,
    lastLoginAt: accountRow.last_login_at,
    createdAt: accountRow.created_at,
  };
}

/** Le compte et son empreinte de mot de passe (connexion uniquement : l'empreinte ne sort jamais du service). */
export async function findAccountCredentialsByUsername(username) {
  const [accountRow] = await queryDatabase(
    `SELECT technician_id, username, role, is_active, password_hash
       FROM main_app.accounts WHERE username = $1`,
    [username],
  );
  return accountRow
    ? {
        technicianId: accountRow.technician_id,
        username: accountRow.username,
        role: accountRow.role,
        isActive: accountRow.is_active,
        passwordHash: accountRow.password_hash,
      }
    : null;
}

export async function findPasswordHashByTechnicianId(technicianId) {
  const [accountRow] = await queryDatabase("SELECT password_hash FROM main_app.accounts WHERE technician_id = $1", [technicianId]);
  return accountRow?.password_hash ?? null;
}

export async function findAccountByTechnicianId(technicianId) {
  const [accountRow] = await queryDatabase(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM main_app.accounts AS accounts
       JOIN public.technician AS technicians ON technicians.technician_id = accounts.technician_id
      WHERE accounts.technician_id = $1`,
    [technicianId],
  );
  return accountRow ? toAccount(accountRow) : null;
}

export async function findAllAccounts() {
  const accountRows = await queryDatabase(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM main_app.accounts AS accounts
       JOIN public.technician AS technicians ON technicians.technician_id = accounts.technician_id
      ORDER BY accounts.username`,
  );
  return accountRows.map(toAccount);
}

export async function countActiveAdministrators() {
  const [countRow] = await queryDatabase(
    "SELECT count(*)::int AS administrator_count FROM main_app.accounts WHERE role = 'admin' AND is_active",
  );
  return countRow.administrator_count;
}

/** Le technicien du chatbot, et s'il a déjà un compte (un technicien = un compte au plus). */
export async function findTechnicianWithAccountState(technicianId, databaseClient = null) {
  const [technicianRow] = await queryDatabase(
    `SELECT technicians.technician_id, technicians.full_name, accounts.technician_id IS NOT NULL AS has_account
       FROM public.technician AS technicians
       LEFT JOIN main_app.accounts AS accounts ON accounts.technician_id = technicians.technician_id
      WHERE technicians.technician_id = $1`,
    [technicianId],
    databaseClient,
  );
  return technicianRow
    ? { technicianId: technicianRow.technician_id, fullName: technicianRow.full_name, hasAccount: technicianRow.has_account }
    : null;
}

/**
 * Ligne MINIMALE dans la table d'identité du chatbot : full_name est la seule
 * colonne obligatoire (migration 0001) ; active prend sa valeur par défaut (TRUE).
 * Les autres colonnes (employee_code, email, phone, region) restent vides.
 */
export async function insertMinimalTechnician(fullName, databaseClient) {
  const [technicianRow] = await queryDatabase(
    "INSERT INTO public.technician (full_name) VALUES ($1) RETURNING technician_id",
    [fullName],
    databaseClient,
  );
  return technicianRow.technician_id;
}

export async function usernameIsTaken(username, databaseClient = null) {
  const rows = await queryDatabase("SELECT 1 FROM main_app.accounts WHERE username = $1", [username], databaseClient);
  return rows.length > 0;
}

export async function insertAccount({ technicianId, username, passwordHash, role }, databaseClient) {
  await queryDatabase(
    `INSERT INTO main_app.accounts (technician_id, username, password_hash, role)
     VALUES ($1, $2, $3, $4)`,
    [technicianId, username, passwordHash, role],
    databaseClient,
  );
}

export async function recordSuccessfulLogin(technicianId) {
  await queryDatabase(
    `UPDATE main_app.accounts
        SET last_login_at = now(), failed_login_count = 0, updated_at = now()
      WHERE technician_id = $1`,
    [technicianId],
  );
}

export async function recordFailedLoginOnAccount(technicianId) {
  await queryDatabase(
    `UPDATE main_app.accounts
        SET failed_login_count = failed_login_count + 1, last_failed_login_at = now()
      WHERE technician_id = $1`,
    [technicianId],
  );
}

export async function updateAccountRole(technicianId, role) {
  await queryDatabase("UPDATE main_app.accounts SET role = $2, updated_at = now() WHERE technician_id = $1", [technicianId, role]);
}

export async function updateAccountActiveState(technicianId, isActive, databaseClient = null) {
  await queryDatabase(
    "UPDATE main_app.accounts SET is_active = $2, updated_at = now() WHERE technician_id = $1",
    [technicianId, isActive],
    databaseClient,
  );
}

export async function updateAccountPasswordHash(technicianId, passwordHash, databaseClient = null) {
  await queryDatabase(
    `UPDATE main_app.accounts
        SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, updated_at = now()
      WHERE technician_id = $1`,
    [technicianId, passwordHash],
    databaseClient,
  );
}
