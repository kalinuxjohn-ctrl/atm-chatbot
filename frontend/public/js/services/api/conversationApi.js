/**
 * API de l'historique d'une conversation.
 *
 * ⏳ MOCK : le backend enregistre bien les messages, mais n'expose aucune
 * route pour les relire. En attendant, l'historique est conservé dans le
 * sessionStorage de l'onglet (il survit à un rechargement de page).
 *
 * TODO: remplacer loadConversation par la future route
 *       GET /chat/{conversation_id}/messages.
 */

import { STORAGE_KEYS } from "../../config.js";

const EMPTY_CONVERSATION = { conversationId: null, deviceType: "gab", messages: [] };

/**
 * @returns {Promise<{conversationId: number|null, deviceType: "gab"|"tpe", messages: Array<{role: string, text: string, channel: string, time: string}>}>}
 */
export async function loadConversation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.conversation) || "null");
    if (saved && Array.isArray(saved.messages)) return { ...EMPTY_CONVERSATION, ...saved };
  } catch (error) {
    console.warn("Historique local illisible, il est ignoré.", error);
  }
  return { ...EMPTY_CONVERSATION, messages: [] };
}

export async function saveConversation(conversation) {
  sessionStorage.setItem(STORAGE_KEYS.conversation, JSON.stringify(conversation));
}

export async function clearConversation() {
  sessionStorage.removeItem(STORAGE_KEYS.conversation);
}
