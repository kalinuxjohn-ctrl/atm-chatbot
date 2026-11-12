/**
 * Fil de conversation de l’ATM-Chatbot, PARTAGÉ par le chat écrit et le mode vocal.
 *
 *   chat écrit ──┐
 *                ├─> conversationService.ask() ──> chatApi / voiceApi
 *   mode vocal ──┘            │
 *                             └─> événements "message" ──> affichage dans le chat
 *
 * Les composants ne savent pas si la réponse vient d'un mock ou du backend.
 */

import { formatTime } from "../utils/dom.js";
import { selectErrorCode, sendMessage } from "./api/chatApi.js";
import { clearConversation, loadConversation, readConversation, saveConversation } from "./api/conversationApi.js";
import { processVoiceConversation } from "./api/voiceApi.js";

const DEVICE_TYPES = ["gab", "tpe"]; // alignés sur l'ENUM device_type du backend

export function createConversationService({ technicianId }) {
  let state = { conversationId: null, deviceType: "gab", messages: [] };
  const listeners = new Set();

  const emit = (event) => listeners.forEach((listener) => listener(event));
  const persist = () => saveConversation(state, technicianId);

  /** extra : ex. { canProposeSolution: true } quand la réponse contient des solutions. */
  function addMessage(role, text, channel, extra = {}) {
    const message = { role, text, channel, time: formatTime(), ...extra };
    const next = { ...state, messages: [...state.messages, message] };
    saveConversation(next, technicianId);
    state = next;
    emit({ type: "message", message });
    return message;
  }

  return {
    async restore() {
      state = await loadConversation(technicianId);
      return state;
    },

    async open(conversationId) {
      const restored = await readConversation(conversationId, technicianId);
      await saveConversation(restored, technicianId);
      state = restored;
      emit({ type: "restored", state });
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
     * @param {{ channel?: "text"|"voice", silent?: boolean, photo?: {media_type: string, data_base64: string}|null, onDelta?: ((text: string) => void)|null }} options
     *        silent = le message utilisateur est déjà affiché (nouvel essai) ;
     *        photo = photo jointe (chat écrit seulement), jamais conservée dans l'historique local ;
     *        onDelta = morceaux provisoires, sans sauvegarde avant la réponse finale
     */
    async ask(text, { channel = "text", silent = false, photo = null, onDelta = null } = {}) {
      // Seule une mention de la photo est affichée et gardée (sessionStorage trop petit pour l'image).
      const shownText = photo ? [text, "📷 Photo jointe"].filter(Boolean).join("\n") : text;
      if (!silent) addMessage("user", shownText, channel);

      const request = { technicianId, conversationId: state.conversationId, deviceType: state.deviceType };
      const result =
        channel === "voice"
          ? await processVoiceConversation({ ...request, transcript: text })
          : await sendMessage({ ...request, message: text, photo, onDelta }).then(({ conversationId, reply, ...availability }) => ({
              conversationId,
              text: reply,
              ...availability,
            }));

      state.conversationId = result.conversationId;
      addMessage("assistant", result.text, channel, {
        canProposeSolution: result.solutionProposalAvailable === true,
        canAddIntervention: result.interventionAddAvailable === true,
        interventionProblem: result.interventionAddProblem ?? null,
        detectedErrorCode: result.detectedErrorCode ?? null,
        errorCodeId: result.errorCodeId ?? null,
      });
      return result;
    },

    async selectErrorCode(errorCodeId) {
      const result = await selectErrorCode({
        errorCodeId, technicianId, conversationId: state.conversationId, deviceType: state.deviceType,
      });
      state.conversationId = result.conversationId;
      const reference = { detectedErrorCode: result.detectedErrorCode, errorCodeId: result.errorCodeId };
      addMessage("user", `Code erreur ${result.detectedErrorCode}`, "text", reference);
      addMessage("assistant", result.reply, "text", reference);
      return result.reply;
    },

    /**
     * Ajoute un échange local (ex. panne fréquente) : affiché et sauvegardé, mais
     * sans aucun appel au backend -- le backend ne voit donc pas cet échange.
     */
    addLocalExchange(userText, replyText) {
      addMessage("user", userText, "text");
      addMessage("assistant", replyText, "text");
    },

    /**
     * Réponse de l’ATM-Chatbot produite HORS de ask() (ex. confirmation d'une
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
      await clearConversation(technicianId);
      emit({ type: "reset" });
    },

    /** @returns {() => void} désabonnement */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
