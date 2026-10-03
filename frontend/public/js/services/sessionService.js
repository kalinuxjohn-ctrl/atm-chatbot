/**
 * Session du technicien connecté (localStorage).
 * La connexion passe par authApi, aujourd'hui simulé.
 */

import { STORAGE_KEYS } from "../config.js";
import { login as loginRequest } from "./api/authApi.js";
import { clearConversation } from "./api/conversationApi.js";

/** @returns {{technicianId: number, displayName: string} | null} */
export function getSession() {
  try {
    const session = JSON.parse(localStorage.getItem(STORAGE_KEYS.session) || "null");
    return Number.isInteger(session?.technicianId) ? session : null;
  } catch {
    return null;
  }
}

export async function login(credentials) {
  const session = await loginRequest(credentials);
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
  return session;
}

export async function logout() {
  localStorage.removeItem(STORAGE_KEYS.session);
  await clearConversation();
}

/** Page protégée : renvoie vers l'accueil (dialogue de connexion ouvert) sans session. */
export function requireSession() {
  const session = getSession();
  if (!session) window.location.replace("/?login=1");
  return session;
}
