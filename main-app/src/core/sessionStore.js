/**
 * Sessions côté serveur, PARTAGÉES par tous les conteneurs.
 *
 * Pourquoi dans core/ et pas dans la fonctionnalité auth : chaque conteneur
 * (carte, messagerie, appels) vérifie LUI-MÊME la session, directement en
 * base, sans appeler le conteneur auth. Si auth est arrêté ou redémarre, les
 * utilisateurs déjà connectés continuent d'utiliser la carte et la messagerie.
 * C'est le seul accès SQL hors de models/, limité aux tables de session.
 *
 * Le navigateur reçoit un token aléatoire de 32 octets ; la base ne garde que
 * son empreinte SHA-256. Une fuite de la table sessions ne permet donc pas
 * de se faire passer pour quelqu'un.
 */

import { createHash, randomBytes } from "node:crypto";

import { queryDatabase } from "./database.js";

/**
 * Le préfixe __Host- (cookie Secure, sans Domain, Path=/) empêche un
 * sous-domaine ou une page HTTP d'écraser le cookie de session. Il exige
 * Secure : en développement HTTP, on garde un nom sans préfixe.
 */
export function getSessionCookieName(cookieSecure) {
  return cookieSecure ? "__Host-main_app_session" : "main_app_session";
}

export function hashSessionToken(sessionToken) {
  return createHash("sha256").update(sessionToken, "utf8").digest("hex");
}

/** Crée une session et renvoie le token EN CLAIR : à mettre dans le cookie, jamais stocké tel quel. */
export async function createSessionForTechnician({ technicianId, sessionDurationHours, ipAddress, userAgent }, databaseClient = null) {
  const sessionToken = randomBytes(32).toString("base64url");
  const [createdSession] = await queryDatabase(
    `INSERT INTO main_app.sessions (token_hash, technician_id, expires_at, created_ip_address, created_user_agent)
     VALUES ($1, $2, now() + make_interval(hours => $3), $4, left($5, 300))
     RETURNING expires_at`,
    [hashSessionToken(sessionToken), technicianId, sessionDurationHours, ipAddress, userAgent ?? null],
    databaseClient,
  );
  return { sessionToken, expiresAt: createdSession.expires_at };
}

/**
 * L'utilisateur d'une session encore valide, ou null. Le compte doit être
 * actif : désactiver un compte coupe immédiatement toutes ses sessions.
 */
export async function findAuthenticatedUserBySessionToken(sessionToken) {
  if (typeof sessionToken !== "string" || sessionToken.length < 32 || sessionToken.length > 128) {
    return null;
  }
  const [sessionUser] = await queryDatabase(
    `SELECT accounts.technician_id, accounts.username, accounts.role
       FROM main_app.sessions AS sessions
       JOIN main_app.comptes AS accounts ON accounts.technician_id = sessions.technician_id
      WHERE sessions.token_hash = $1
        AND sessions.expires_at > now()
        AND accounts.is_active`,
    [hashSessionToken(sessionToken)],
  );
  if (!sessionUser) {
    return null;
  }
  return { technicianId: sessionUser.technician_id, username: sessionUser.username, role: sessionUser.role };
}

/**
 * DÉVELOPPEMENT SEULEMENT (MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME) : le compte
 * actif à utiliser quand la connexion est désactivée, ou null s'il n'existe pas.
 */
export async function findActiveAccountForDevelopmentAutoLogin(username) {
  const [account] = await queryDatabase(
    `SELECT technician_id, username, role
       FROM main_app.comptes
      WHERE username = $1 AND is_active`,
    [username],
  );
  return account ? { technicianId: account.technician_id, username: account.username, role: account.role } : null;
}

export async function deleteSessionByToken(sessionToken) {
  if (typeof sessionToken !== "string") {
    return;
  }
  await queryDatabase("DELETE FROM main_app.sessions WHERE token_hash = $1", [hashSessionToken(sessionToken)]);
}

/** Nettoyage périodique (jobs/cleanupExpiredSessions.js) : une session expirée ne sert plus. */
export async function deleteExpiredSessions() {
  const deletedRows = await queryDatabase("DELETE FROM main_app.sessions WHERE expires_at <= now() RETURNING 1");
  return deletedRows.length;
}

/** Déconnecte partout (mot de passe changé, compte désactivé), sauf éventuellement la session courante. */
export async function deleteSessionsOfTechnician(technicianId, { keepSessionToken = null } = {}, databaseClient = null) {
  await queryDatabase(
    `DELETE FROM main_app.sessions
      WHERE technician_id = $1 AND ($2::text IS NULL OR token_hash <> $2)`,
    [technicianId, keepSessionToken ? hashSessionToken(keepSessionToken) : null],
    databaseClient,
  );
}
