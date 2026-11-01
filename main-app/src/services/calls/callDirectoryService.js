/**
 * Ce que la page Appels affiche : collègues joignables (en ligne ou non) et
 * historique des appels de l'utilisateur.
 */

import { findCallContacts, findCallHistoryOfTechnician } from "../../models/calls/callModel.js";

export async function listCallContactsWithPresence(user, coordinator) {
  const contacts = await findCallContacts(user.technicianId);
  return contacts
    .map((contact) => ({ ...contact, isOnline: coordinator.isTechnicianOnline(contact.technicianId) }))
    .sort((left, right) => Number(right.isOnline) - Number(left.isOnline) || left.username.localeCompare(right.username));
}

export async function listCallHistory(user, limit) {
  return findCallHistoryOfTechnician(user.technicianId, limit);
}
