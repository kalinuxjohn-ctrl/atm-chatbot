/**
 * Accès SQL des appels : journal (main_app.journal_appels) et comptes joignables.
 */

import { queryDatabase } from "../../core/database.js";

export async function insertCallLog({ callId, callerTechnicianId, calleeTechnicianId, status, endReason, startedAt, answeredAt, endedAt }) {
  await queryDatabase(
    `INSERT INTO main_app.journal_appels
        (id, caller_technician_id, callee_technician_id, status, end_reason, started_at, answered_at, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [callId, callerTechnicianId, calleeTechnicianId, status, endReason, startedAt, answeredAt, endedAt],
  );
}

/** Derniers appels passés ou reçus, avec le nom de l'autre personne. */
export async function findCallHistoryOfTechnician(technicianId, limit = 50) {
  const historyRows = await queryDatabase(
    `SELECT call_logs.id, call_logs.status, call_logs.end_reason, call_logs.started_at, call_logs.answered_at, call_logs.ended_at,
            call_logs.caller_technician_id = $1 AS is_outgoing,
            other_accounts.technician_id AS other_technician_id, other_accounts.username AS other_username
       FROM main_app.journal_appels AS call_logs
       LEFT JOIN main_app.comptes AS other_accounts
              ON other_accounts.technician_id = CASE WHEN call_logs.caller_technician_id = $1
                                                     THEN call_logs.callee_technician_id
                                                     ELSE call_logs.caller_technician_id END
      WHERE call_logs.caller_technician_id = $1 OR call_logs.callee_technician_id = $1
      ORDER BY call_logs.started_at DESC
      LIMIT $2`,
    [technicianId, limit],
  );
  return historyRows.map((historyRow) => ({
    callId: historyRow.id,
    status: historyRow.status,
    endReason: historyRow.end_reason,
    isOutgoing: historyRow.is_outgoing,
    otherParticipant: historyRow.other_technician_id
      ? { technicianId: historyRow.other_technician_id, username: historyRow.other_username }
      : null,
    startedAt: historyRow.started_at,
    answeredAt: historyRow.answered_at,
    endedAt: historyRow.ended_at,
  }));
}

/** Le compte à appeler, s'il existe et est actif. */
export async function findCallableAccount(technicianId) {
  const [accountRow] = await queryDatabase(
    "SELECT technician_id, username FROM main_app.comptes WHERE technician_id = $1 AND is_active",
    [technicianId],
  );
  return accountRow ? { technicianId: accountRow.technician_id, username: accountRow.username } : null;
}

export async function findCallContacts(technicianId) {
  const contactRows = await queryDatabase(
    `SELECT technician_id, username FROM main_app.comptes
      WHERE is_active AND technician_id <> $1
      ORDER BY username
      LIMIT 500`,
    [technicianId],
  );
  return contactRows.map((contactRow) => ({ technicianId: contactRow.technician_id, username: contactRow.username }));
}
