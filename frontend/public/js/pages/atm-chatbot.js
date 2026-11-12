/**
 * Page ATM-Chatbot : assemble les briques de l'interface.
 *
 *   sessionService ──────> technicien connecté (sinon retour à l'accueil)
 *   conversationService ─> UNIQUE fil de conversation (POST /api/chat ou mock)
 *        ▲            ▲
 *   chat écrit    Chat vocal (voiceMode) : les deux passent par submitMessage()
 *
 *   devicePicker / suggestions / composerDictation
 *   ─> uniquement de l'affichage et des interactions, aucun appel réseau.
 */

import { FORCE_MOCKS } from "../config.js";
import { createChatView, playSendBurst } from "../components/chatView.js";
import { createComposerDictation } from "../components/composerDictation.js";
import { createComposerPhoto } from "../components/composerPhoto.js";
import { DEVICE_OPTIONS, createDevicePicker } from "../components/devicePicker.js";
import { hydrateIcons } from "../components/icons.js";
import { createSettingsPanel } from "../components/settingsPanel.js";
import { createSuggestionMenus } from "../components/suggestions.js";
import { createSolutionProposalDialog } from "../components/solutionProposalDialog.js";
import { createVoiceMode } from "../components/voiceMode.js";
import { getFriendlyErrorMessage } from "../core/httpClient.js";
import { createConversationService } from "../services/conversationService.js";
import { listKnownErrorCodes } from "../services/api/errorCodeApi.js";
import { isPhotoOcrEnabled } from "../services/api/photoApi.js";
import { getUsualProblemReply, listUsualProblems } from "../services/api/usualProblemApi.js";
import { getPreferences, onPreferencesChange } from "../services/preferencesService.js";
import { requireSession } from "../services/sessionService.js";
import { createConversationHistory } from "../components/conversationHistory.js";
import {
  isSpeechSynthesisSupported,
  speak,
  stopSpeaking,
} from "../services/speech/speechSynthesisService.js";

const READY_STATUS = "Prêt à vous aider";

const session = requireSession();
if (session) void initAtmChatbot(session);

async function initAtmChatbot({ technicianId, displayName }) {
  /* ---------- Éléments de la page ---------- */
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  hydrateIcons(document);

  const elements = {
    technicianAvatar: $("#technician-avatar"),
    technicianName: $("#technician-name"),
    technicianNumber: $("#technician-number"),
    newConversationButtons: $$("[data-new-conversation]"),
    status: $("#atm-chatbot-status"),
    demoBadge: $("#demo-badge"),
    stopReadingButton: $("#stop-reading-button"),
    voiceModeButtons: $$("[data-open-voice-mode]"),
    settingsButtons: $$("[data-open-settings]"),
    chatPanel: $(".chat-panel"),
    conversation: $("#conversation"),
    form: $("#message-form"),
    input: $("#message-input"),
    sendButton: $("#send-button"),
    micButton: $("#mic-button"),
    photoButton: $("#photo-button"),
    photoInput: $("#photo-input"),
    photoPreview: $("#photo-preview"),
    dictationStatus: $("#dictation-status"),
    characterCount: $("#character-count"),
    composerSuggestions: $("#composer-suggestions"),
  };

  /* ---------- Services et composants ---------- */
  const conversation = createConversationService({ technicianId });
  let requestInProgress = false;
  let streamingReply = null;
  // Entrées des menus de suggestions, lues par le backend pour l'équipement sélectionné.
  let suggestionLists = { usualProblems: [], errorCodes: [] };

  const chatView = createChatView({
    conversationElement: elements.conversation,
    userName: displayName,
    getAvatarKind: () => getPreferences().avatar,
    onListen: (text) => void readAloud(text),
    onProposeSolution: () => openSolutionProposal(),
  });

  // « Proposer une solution » : le problème est relu par le backend, la page
  // ne transmet que la conversation et le technicien connectés.
  const solutionProposalDialog = createSolutionProposalDialog({
    dialog: $("#proposal-dialog"),
    onSubmitted: (reply) => {
      chatView.dismissProposalOffer();
      conversation.addAssistantMessage(reply);
    },
  });

  function openSolutionProposal() {
    if (requestInProgress) return;
    dictation.cancel();
    stopReading();
    void solutionProposalDialog.open({
      conversationId: conversation.conversationId,
      technicianId: conversation.technicianId,
    });
  }

  const devicePicker = createDevicePicker({
    container: $("#device-picker"),
    onChange: (deviceType) => {
      conversation.setDeviceType(deviceType);
      void loadSuggestions();
    },
  });

  const dictation = createComposerDictation({
    button: elements.micButton,
    statusElement: elements.dictationStatus,
    input: elements.input,
    onTextChange: () => {
      resizeInput();
      updateComposerState();
    },
    beforeStart: () => stopReading(),
  });

  // Photo jointe au prochain message : l’ATM-Chatbot en lit le texte affiché.
  const photoAttachment = createComposerPhoto({
    button: elements.photoButton,
    fileInput: elements.photoInput,
    preview: elements.photoPreview,
    onChange: () => updateComposerState(),
  });

  const voiceMode = createVoiceMode({
    dialog: $("#voice-dialog"),
    getPreferences,
    // Le mode vocal utilise le MÊME flux que le chat écrit : même conversation, même historique.
    askAtmChatbot: async (text) => {
      const { reply, error } = await submitMessage(text, { channel: "voice", readReply: false });
      if (error) throw new Error(getFriendlyErrorMessage(error));
      return reply;
    },
    getContextLabel: () => {
      const device = DEVICE_OPTIONS.find((option) => option.value === conversation.deviceType);
      return device ? `Équipement : ${device.name}` : "";
    },
  });

  const settingsPanel = createSettingsPanel({ dialog: $("#settings-dialog") });
  const history = createConversationHistory({
    dialog: $("#conversation-history-dialog"),
    technicianId,
    onResume: async (conversationId) => {
      if (requestInProgress) throw new Error("Une réponse est encore en cours.");
      dictation.cancel();
      stopReading();
      voiceMode.close();
      setBusy(true);
      try {
        await conversation.open(conversationId);
        elements.input.value = "";
        photoAttachment.clear();
        resizeInput();
        devicePicker.setValue(conversation.deviceType);
        void loadSuggestions();
      } finally {
        setBusy(false);
      }
    },
  });

  /* ---------- Identité du technicien ---------- */
  elements.technicianName.textContent = displayName;
  elements.technicianNumber.textContent = `Technicien n° ${technicianId}`;
  elements.technicianAvatar.textContent = getInitials(displayName);
  elements.demoBadge.hidden = !FORCE_MOCKS;

  /* ---------- Statut de l’ATM-Chatbot ---------- */
  /** Texte sous le nom de l’ATM-Chatbot + animation de son avatar. */
  function setStatus(text, avatarState = "idle") {
    elements.status.textContent = text;
    elements.conversation.dataset.avatarState = avatarState;
  }

  /* ---------- Préférences (avatar, voix, fonctions vocales) ---------- */
  function applyPreferences(preferences) {
    // Avatar de l’ATM-Chatbot dans les messages.
    chatView.refreshAvatars();

    elements.micButton.hidden = !preferences.voiceModeEnabled;
    elements.voiceModeButtons.forEach((button) => (button.hidden = !preferences.voiceModeEnabled));
    if (!preferences.voiceModeEnabled) dictation.cancel();
  }

  /* ---------- Lecture à voix haute ---------- */
  function stopReading() {
    stopSpeaking();
    elements.stopReadingButton.hidden = true;
  }

  async function readAloud(text) {
    if (!isSpeechSynthesisSupported()) return;
    elements.stopReadingButton.hidden = false;
    setStatus("Lecture de la réponse…", "speaking");
    await speak(text, getPreferences());
    elements.stopReadingButton.hidden = true;
    if (!requestInProgress) setStatus(READY_STATUS);
  }

  /* ---------- Zone de saisie ---------- */
  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = `${Math.min(elements.input.scrollHeight, 168)}px`;
  }

  function updateComposerState() {
    // Une photo seule suffit : son texte décrit souvent la panne mieux qu'un message.
    elements.sendButton.disabled = requestInProgress || (!elements.input.value.trim() && !photoAttachment.photo);
    photoAttachment.setDisabled(requestInProgress);
    elements.characterCount.textContent = `${elements.input.value.length} / ${elements.input.maxLength}`;
  }

  function setBusy(isBusy) {
    requestInProgress = isBusy;
    elements.chatPanel.setAttribute("aria-busy", String(isBusy));
    elements.newConversationButtons.forEach((button) => (button.disabled = isBusy));
    if (document.documentElement.hasAttribute("data-embedded")) {
      window.parent.postMessage({ type: "atm-chatbot:state", busy: isBusy }, window.location.origin);
    }
    updateSuggestionMenusState();
    devicePicker.setDisabled(isBusy);
    setStatus(isBusy ? "L’ATM-Chatbot réfléchit…" : READY_STATUS, isBusy ? "processing" : "idle");
    updateComposerState();
  }

  /**
   * Envoie un message via conversationService (flux progressif pour le chat écrit).
   * Ne lève jamais : renvoie { reply } ou { error } pour que le mode vocal puisse réagir.
   * @param {{ channel?: "text"|"voice", silent?: boolean, readReply?: boolean, photo?: object|null }} options
   *        silent = message déjà affiché (bouton "Réessayer") ; photo = photo jointe (chat écrit)
   */
  async function submitMessage(text, { channel = "text", silent = false, readReply = true, photo = null } = {}) {
    if (requestInProgress) return { error: new Error("Une réponse est déjà en cours de préparation.") };
    setBusy(true);
    let removeTyping = () => {};
    let reply = null;
    let error = null;
    try {
      // ask() affiche tout de suite le message du technicien : les points
      // "l’ATM-Chatbot réfléchit" sont ajoutés APRÈS, donc en dessous de lui.
      const pendingAnswer = conversation.ask(text, {
        channel, silent, photo,
        onDelta: channel === "text" ? (delta) => {
          removeTyping();
          streamingReply ??= chatView.beginStreamingReply({ channel });
          streamingReply.appendDelta(delta);
          setStatus("L’ATM-Chatbot rédige sa réponse…", "processing");
        } : null,
      });
      removeTyping = chatView.showTyping();
      ({ text: reply } = await pendingAnswer);
    } catch (caught) {
      error = caught;
      const interrupted = streamingReply;
      interrupted?.interrupt();
      streamingReply = null;
      // « Réessayer » renvoie la même photo.
      chatView.showError(getFriendlyErrorMessage(caught), () => {
        interrupted?.remove();
        void submitMessage(text, { channel, silent: true, readReply, photo });
      });
    } finally {
      removeTyping();
      setBusy(false);
    }
    if (reply && readReply && getPreferences().autoRead) void readAloud(reply);
    return { reply, error };
  }

  /* ---------- Menus de suggestions ---------- */
  /**
   * Relit les deux menus de l'équipement sélectionné auprès du backend
   * (GET /api/usual_problem et /api/error_code). Un menu dont la lecture
   * échoue est simplement masqué : le chat reste utilisable.
   */
  async function loadSuggestions() {
    const deviceType = conversation.deviceType;
    // Vidés tout de suite : les entrées de l'autre équipement ne doivent plus être cliquables.
    suggestionLists = { usualProblems: [], errorCodes: [] };
    renderSuggestions();

    const [usualProblems, errorCodes] = await Promise.all([
      listUsualProblems(deviceType).catch((error) => logSuggestionError("pannes fréquentes", error)),
      listKnownErrorCodes(deviceType).catch((error) => logSuggestionError("codes d'erreur", error)),
    ]);
    // L'équipement a changé pendant la lecture : la réponse arrivée en retard est ignorée.
    if (deviceType !== conversation.deviceType) return;
    suggestionLists = { usualProblems, errorCodes };
    renderSuggestions();
  }

  function logSuggestionError(menuName, error) {
    console.warn(`[suggestions] Menu « ${menuName} » indisponible :`, error);
    return [];
  }

  function renderSuggestions() {
    elements.composerSuggestions.replaceChildren(
      createSuggestionMenus({
        usualProblems: suggestionLists.usualProblems,
        onPickUsualProblem: (usualProblem) =>
          void answerWithSavedReply(usualProblem.label, () => getUsualProblemReply(usualProblem.id)),
        errorCodes: suggestionLists.errorCodes,
        onPickErrorCode: (errorCode) =>
          void answerWithSavedReply(
            `Code erreur ${errorCode.code}`,
            () => conversation.selectErrorCode(errorCode.id),
            { stored: true },
          ),
      }),
    );
    updateSuggestionMenusState();
  }

  /** Menus inactifs pendant qu'une réponse est en préparation. */
  function updateSuggestionMenusState() {
    elements.composerSuggestions.querySelectorAll(".suggestion-trigger").forEach((trigger) => {
      trigger.disabled = requestInProgress;
    });
  }

  /**
   * Réponse enregistrée, sans IA. Les codes passent par la conversation
   * persistante ; les pannes fréquentes restent des échanges locaux.
   */
  async function answerWithSavedReply(userText, fetchReply, { stored = false } = {}) {
    if (requestInProgress) return;
    dictation.cancel();
    stopReading();
    setBusy(true);
    const removeTyping = chatView.showTyping();
    let reply = null;
    try {
      reply = await fetchReply();
    } catch (caught) {
      chatView.showError(getFriendlyErrorMessage(caught), () => void answerWithSavedReply(userText, fetchReply, { stored }));
      return;
    } finally {
      removeTyping();
      setBusy(false);
    }
    if (!stored) conversation.addLocalExchange(userText, reply);
    if (getPreferences().autoRead) void readAloud(reply);
  }

  /* ---------- Événements du chat écrit ---------- */
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = elements.input.value.trim();
    const photo = photoAttachment.photo;
    if ((!text && !photo) || requestInProgress) return;
    dictation.cancel();
    playSendBurst(elements.form);
    // Le message s'envolera depuis la zone de saisie jusqu'à sa place dans le fil.
    chatView.launchNextUserMessage(elements.input.getBoundingClientRect());
    elements.input.value = "";
    photoAttachment.clear();
    resizeInput();
    updateComposerState();
    void submitMessage(text, { photo });
  });

  elements.input.addEventListener("input", () => {
    resizeInput();
    updateComposerState();
  });

  // Entrée = envoyer, Maj + Entrée = nouvelle ligne.
  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!elements.sendButton.disabled) elements.form.requestSubmit();
    }
  });

  /* ---------- Boutons ---------- */
  elements.voiceModeButtons.forEach((button) =>
    button.addEventListener("click", () => {
      dictation.cancel();
      stopReading();
      voiceMode.open();
    }),
  );
  elements.settingsButtons.forEach((button) => button.addEventListener("click", () => settingsPanel.open()));
  elements.stopReadingButton.addEventListener("click", stopReading);

  function startNewConversation() {
      if (requestInProgress) return;
      dictation.cancel();
      stopReading();
      voiceMode.close();
      elements.input.value = "";
      photoAttachment.clear();
      resizeInput();
      updateComposerState();
      void conversation.reset();
  }
  elements.newConversationButtons.forEach((button) => button.addEventListener("click", startNewConversation));

  /* ---------- Synchronisation vue <-> conversation ---------- */
  // Tous les messages (écrits OU vocaux) arrivent par cet abonnement.
  conversation.subscribe((event) => {
    if (event.type === "message") {
      if (event.message.role === "assistant" && streamingReply) {
        streamingReply.complete(event.message);
        streamingReply = null;
      } else {
        chatView.appendMessage(event.message);
      }
    }
    if (event.type === "reset") {
      chatView.reset();
      elements.input.focus();
    }
    if (event.type === "restored") {
      chatView.reset();
      event.state.messages.forEach((message) => chatView.appendMessage(message, { animate: false }));
    }
  });
  onPreferencesChange(applyPreferences);

  /* ---------- Démarrage : restauration de la conversation de l'onglet ---------- */
  applyPreferences(getPreferences());
  const restored = await conversation.restore();
  devicePicker.setValue(restored.deviceType);
  chatView.reset();
  restored.messages.forEach((message) => chatView.appendMessage(message, { animate: false }));
  updateComposerState();
  setStatus(READY_STATUS);
  if (document.documentElement.hasAttribute("data-embedded")) {
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type !== "atm-chatbot:command") return;
      if (event.data.action === "settings") settingsPanel.open();
      if (event.data.action === "new-conversation") startNewConversation();
      if (event.data.action === "conversations" && !requestInProgress) history.open();
    });
    window.parent.postMessage({ type: "atm-chatbot:ready" }, window.location.origin);
  }

  // Sans bloquer le démarrage : les menus apparaissent dès que le backend a
  // répondu (en cas d'échec, seuls ces menus manquent).
  void loadSuggestions();
  // Bouton photo affiché seulement si le backend accepte les photos (PHOTO_OCR_ENABLED).
  void isPhotoOcrEnabled().then((enabled) => photoAttachment.setAvailable(enabled));
}

/** "Raoul Dupont" -> "RD" (pastille du technicien). */
function getInitials(name) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?"
  );
}
