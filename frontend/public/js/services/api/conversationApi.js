/**
 * API de l'historique d'une conversation.
 *
 * La conversation active est gardée dans l'onglet, isolée par technicien.
 * L'historique durable est relu en base avec contrôle du propriétaire.
 */

import { STORAGE_KEYS } from "../../config.js";
import { getJson } from "../../core/httpClient.js";

const EMPTY_CONVERSATION = { conversationId: null, deviceType: "gab", messages: [] };

/**
 * @returns {Promise<{conversationId: number|null, deviceType: "gab"|"tpe", messages: Array<{role: string, text: string, channel: string, time: string}>}>}
 */
export async function loadConversation(technicianId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`${STORAGE_KEYS.conversation}.${technicianId}`) || "null");
    if (saved && Array.isArray(saved.messages)) return { ...EMPTY_CONVERSATION, ...saved };
  } catch (error) {
    console.warn("Historique local illisible, il est ignoré.", error);
  }
  return { ...EMPTY_CONVERSATION, messages: [] };
}

export function saveConversation(conversation, technicianId) {
  sessionStorage.setItem(`${STORAGE_KEYS.conversation}.${technicianId}`, JSON.stringify(conversation));
}

export async function clearConversation(technicianId) {
  sessionStorage.removeItem(`${STORAGE_KEYS.conversation}.${technicianId}`);
  sessionStorage.removeItem(STORAGE_KEYS.conversation);
}

export function listConversations(technicianId, offset = 0) {
  return getJson(`/chat/conversations?technician_id=${encodeURIComponent(technicianId)}&offset=${offset}`);
}

export async function readConversation(conversationId, technicianId) {
  const history = await getJson(`/chat/conversations/${encodeURIComponent(conversationId)}?technician_id=${encodeURIComponent(technicianId)}`);
  return {
    conversationId: history.conversation_id,
    deviceType: history.device_type,
    messages: history.messages.map((message) => ({
      role: message.role,
      text: message.content,
      detectedErrorCode: message.detected_error_code ?? null,
      errorCodeId: message.error_code_id ?? null,
      channel: "text",
      time: new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.created_at)),
    })),
  };
}
