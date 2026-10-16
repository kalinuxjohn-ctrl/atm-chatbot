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

  /** extra : ex. { canProposeSolution: true } quand la réponse contient des solutions. */
  function addMessage(role, text, channel, extra = {}) {
    const message = { role, text, channel, time: formatTime(), ...extra };
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
          : await sendMessage({ ...request, message: text }).then(({ conversationId, reply, ...availability }) => ({
              conversationId,
              text: reply,
              ...availability,
            }));

      state.conversationId = result.conversationId;
      addMessage("assistant", result.text, channel, {
        canProposeSolution: result.solutionProposalAvailable === true,
        canAddIntervention: result.interventionAddAvailable === true,
        interventionProblem: result.interventionAddProblem ?? null,
      });
      return result;
    },

    /**
     * Ajoute un échange dont la réponse est DÉJÀ connue côté frontend (ex. code
     * d'erreur fréquent) : affiché et sauvegardé comme les autres messages, mais
     * sans aucun appel au backend -- le backend ne voit donc pas cet échange.
     */
    addLocalExchange(userText, replyText) {
      addMessage("user", userText, "text");
      addMessage("assistant", replyText, "text");
    },

    /**
     * Réponse du Copilote produite HORS de ask() (ex. confirmation d'une
     * proposition de solution ou d'intervention). Cette confirmation est
     * conservée dans l'historique local de l'onglet.
     */
    addAssistantMessage(text) {
      addMessage("assistant", text, "text");
    },

    get technicianId() {
      return technicianId;
    },

    dismissContributionOffers() {
      state.messages.forEach((message) => {
        message.canAddIntervention = false;
        message.canProposeSolution = false;
      });
      persist();
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
