/**
 * Fil de conversation du Copilote, PARTAGÉ par le chat écrit et le mode vocal.
 *
 *   chat écrit ──┐
 *                ├─> conversationService.ask() ──> chatApi / voiceApi
 *   mode vocal ──┘            │
 *                             └─> événements "message" ──> affichage dans le chat
 *
 * Les composants ne savent pas si la réponse vient d'un mock ou du backend.
 */

import { formatTime } from "../utils/dom.js";
import { sendMessage } from "./api/chatApi.js";
import { clearConversation, loadConversation, saveConversation } from "./api/conversationApi.js";
import { processVoiceConversation } from "./api/voiceApi.js";

const DEVICE_TYPES = ["gab", "tpe"]; // alignés sur l'ENUM device_type du backend

export function createConversationService({ technicianId }) {
  let state = { conversationId: null, deviceType: "gab", messages: [] };
  const listeners = new Set();

  const emit = (event) => listeners.forEach((listener) => listener(event));
  const persist = () => saveConversation(state);

  function addMessage(role, text, channel) {
    const message = { role, text, channel, time: formatTime() };
    state.messages.push(message);
    persist();
    emit({ type: "message", message });
    return message;
  }

  return {
    async restore() {
      state = await loadConversation();
      return state;
    },

    get deviceType() {
      return state.deviceType;
    },

    /** Identifiant renvoyé par POST /api/chat (null avant le premier message). */
    get conversationId() {
      return state.conversationId;
    },

    get messageCount() {
      return state.messages.length;
    },

    setDeviceType(deviceType) {
      if (!DEVICE_TYPES.includes(deviceType)) return;
      state.deviceType = deviceType;
      persist();
    },

    /**
     * Envoie le texte du technicien et renvoie la réponse.
     * @param {"text"|"voice"} channel origine du message (affichée dans le chat)
     * @param {{ silent?: boolean }} options silent = le message utilisateur est déjà affiché (nouvel essai)
     */
    async ask(text, { channel = "text", silent = false } = {}) {
      if (!silent) addMessage("user", text, channel);

      const request = { technicianId, conversationId: state.conversationId, deviceType: state.deviceType };
      const result =
        channel === "voice"
          ? await processVoiceConversation({ ...request, transcript: text })
          : await sendMessage({ ...request, message: text }).then(({ conversationId, reply }) => ({
              conversationId,
              text: reply,
            }));

      state.conversationId = result.conversationId;
      addMessage("assistant", result.text, channel);
      return result;
    },

    async reset() {
      state = { conversationId: null, deviceType: state.deviceType, messages: [] };
      await clearConversation();
      emit({ type: "reset" });
    },

    /** @returns {() => void} désabonnement */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
