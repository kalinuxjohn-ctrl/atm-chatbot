/**
 * Accès SQL au verrouillage temporaire des connexions (main_app.blocages_connexion),
 * par couple (nom saisi, adresse IP).
 */

import { queryDatabase } from "../../core/database.js";

/** Fin du verrouillage en cours pour ce couple, ou null s'il n'est pas verrouillé. */
export async function findActiveLockEnd(attemptedUsername, ipAddress) {
  const [throttleRow] = await queryDatabase(
    `SELECT locked_until FROM main_app.blocages_connexion
      WHERE attempted_username = $1 AND ip_address = $2 AND locked_until > now()`,
    [attemptedUsername, ipAddress],
  );
  return throttleRow?.locked_until ?? null;
}

/**
 * Compte un échec. Les échecs se comptent sur une fenêtre égale à la durée
 * de verrouillage : au-delà, le compteur repart de zéro. Au N-ième échec de
 * la fenêtre, le couple est verrouillé pour `lockMinutes`.
 */
export async function recordFailedAttempt(attemptedUsername, ipAddress, { maximumFailedAttempts, lockMinutes }) {
  await queryDatabase(
    `INSERT INTO main_app.blocages_connexion AS throttles (attempted_username, ip_address, failed_attempts, first_failed_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (attempted_username, ip_address) DO UPDATE SET
       failed_attempts = CASE
         WHEN throttles.first_failed_at < now() - make_interval(mins => $4) THEN 1
         ELSE throttles.failed_attempts + 1 END,
       first_failed_at = CASE
         WHEN throttles.first_failed_at < now() - make_interval(mins => $4) THEN now()
         ELSE throttles.first_failed_at END,
       locked_until = CASE
         WHEN throttles.first_failed_at >= now() - make_interval(mins => $4)
              AND throttles.failed_attempts + 1 >= $3
         THEN now() + make_interval(mins => $4)
         ELSE throttles.locked_until END`,
    [attemptedUsername, ipAddress, maximumFailedAttempts, lockMinutes],
  );
}

export async function clearFailedAttempts(attemptedUsername, ipAddress) {
  await queryDatabase("DELETE FROM main_app.blocages_connexion WHERE attempted_username = $1 AND ip_address = $2", [
    attemptedUsername,
    ipAddress,
  ]);
}

/** Nettoyage périodique : les entrées anciennes et non verrouillées ne servent plus. */
export async function deleteExpiredThrottles() {
  const deletedRows = await queryDatabase(
    `DELETE FROM main_app.blocages_connexion
      WHERE (locked_until IS NULL OR locked_until < now())
        AND first_failed_at < now() - interval '1 day'
      RETURNING 1`,
  );
  return deletedRows.length;
}
