/**
 * Page Copilote : assemble les briques de l'interface.
 *
 *   sessionService ──────> technicien connecté (sinon retour à l'accueil)
 *   conversationService ─> UNIQUE fil de conversation (POST /api/chat ou mock)
 *        ▲            ▲
 *   chat écrit    Chat vocal (voiceMode) : les deux passent par submitMessage()
 *
 *   sidebar / contextPanel / devicePicker / suggestions / composerDictation
 *   ─> uniquement de l'affichage et des interactions, aucun appel réseau.
 */

import { FORCE_MOCKS } from "../config.js";
import { renderAvatar } from "../components/avatar.js";
import { createChatView, playSendBurst } from "../components/chatView.js";
import { createComposerDictation } from "../components/composerDictation.js";
import { createContextPanel } from "../components/contextPanel.js";
import { DEVICE_OPTIONS, createDevicePicker } from "../components/devicePicker.js";
import { hydrateIcons } from "../components/icons.js";
import { createSettingsPanel, formatVoiceLabel } from "../components/settingsPanel.js";
import { createSidebar } from "../components/sidebar.js";
import { createSuggestionList, flySuggestionToConversation } from "../components/suggestions.js";
import { createVoiceMode } from "../components/voiceMode.js";
import { getFriendlyErrorMessage } from "../core/httpClient.js";
import { createConversationService } from "../services/conversationService.js";
import { getPreferences, onPreferencesChange } from "../services/preferencesService.js";
import { logout, requireSession } from "../services/sessionService.js";
import {
  getOnDeviceRecognitionStatus,
  isSpeechRecognitionSupported,
} from "../services/speech/speechRecognitionService.js";
import {
  isSpeechSynthesisSupported,
  resolveVoice,
  speak,
  stopSpeaking,
} from "../services/speech/speechSynthesisService.js";

const READY_STATUS = "Prêt à vous aider";
const RECOGNITION_LABELS = {
  available: "Dictée disponible (hors ligne)",
  downloadable: "Dictée en ligne (hors ligne téléchargeable)",
  downloading: "Dictée en ligne (téléchargement…)",
};

const session = requireSession();
if (session) void initCopilot(session);

async function initCopilot({ technicianId, displayName }) {
  /* ---------- Éléments de la page ---------- */
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  hydrateIcons(document);

  const elements = {
    shell: $("#app-shell"),
    brandAvatar: $("#sidebar-brand-avatar"),
    greetingName: $("#greeting-name"),
    technicianAvatar: $("#technician-avatar"),
    technicianName: $("#technician-name"),
    technicianNumber: $("#technician-number"),
    logoutButton: $("#logout-button"),
    newConversationButton: $("#new-conversation-button"),
    toolbarAvatar: $("#toolbar-avatar"),
    status: $("#copilot-status"),
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
    dictationStatus: $("#dictation-status"),
    characterCount: $("#character-count"),
    composerSuggestions: $("#composer-suggestions"),
  };

  /* ---------- Services et composants ---------- */
  const conversation = createConversationService({ technicianId });
  let requestInProgress = false;
  // Animation du prochain message du technicien ("landing" après la montée d'une bulle).
  let nextUserAnimation = "up";

  createSidebar({
    shell: elements.shell,
    sidebar: $("#app-sidebar"),
    collapseButton: $("#sidebar-collapse-button"),
    openButtons: $$("[data-open-sidebar]"),
    backdrop: $("#sidebar-backdrop"),
  });

  const contextPanel = createContextPanel({
    shell: elements.shell,
    panel: $("#context-panel"),
    toggleButtons: $$("[data-toggle-context]"),
    closeButton: $("#context-close-button"),
    backdrop: $("#context-backdrop"),
  });

  const chatView = createChatView({
    conversationElement: elements.conversation,
    getAvatarKind: () => getPreferences().avatar,
    onListen: (text) => void readAloud(text),
    createWelcomeExtras: () => createSuggestionList({ deviceType: conversation.deviceType, onPick: pickSuggestion }),
  });

  const devicePicker = createDevicePicker({
    container: $("#device-picker"),
    onChange: (deviceType) => {
      conversation.setDeviceType(deviceType);
      renderSuggestions();
      updateContext();
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

  const voiceMode = createVoiceMode({
    dialog: $("#voice-dialog"),
    getPreferences,
    // Le mode vocal utilise le MÊME flux que le chat écrit : même conversation, même historique.
    askCopilot: async (text) => {
      const { reply, error } = await submitMessage(text, { channel: "voice", readReply: false });
      if (error) throw new Error(getFriendlyErrorMessage(error));
      return reply;
    },
  });

  const settingsPanel = createSettingsPanel({ dialog: $("#settings-dialog") });

  /* ---------- Identité du technicien ---------- */
  elements.greetingName.textContent = displayName;
  elements.technicianName.textContent = displayName;
  elements.technicianNumber.textContent = `Technicien n° ${technicianId}`;
  elements.technicianAvatar.textContent = getInitials(displayName);
  elements.demoBadge.hidden = !FORCE_MOCKS;

  /* ---------- Statut du Copilote ---------- */
  /** Texte sous le nom du Copilote + animation de son avatar. */
  function setStatus(text, avatarState = "idle") {
    elements.status.textContent = text;
    elements.toolbarAvatar.firstElementChild?.setAttribute("data-state", avatarState);
  }

  /* ---------- Préférences (avatar, voix, fonctions vocales) ---------- */
  function applyPreferences(preferences) {
    // Avatar du Copilote : en-tête de la sidebar, barre du haut et messages.
    elements.brandAvatar.replaceChildren(renderAvatar(preferences.avatar));
    elements.toolbarAvatar.replaceChildren(renderAvatar(preferences.avatar));
    chatView.refreshAvatars();

    elements.micButton.hidden = !preferences.voiceModeEnabled;
    elements.voiceModeButtons.forEach((button) => (button.hidden = !preferences.voiceModeEnabled));
    if (!preferences.voiceModeEnabled) dictation.cancel();
    void updateVoiceContext(preferences);
  }

  /* ---------- Panneau de contexte ---------- */
  function updateContext() {
    const device = DEVICE_OPTIONS.find((option) => option.value === conversation.deviceType);
    contextPanel.update({
      technician: `${displayName} (n° ${technicianId})`,
      device: device ? `${device.name} · ${device.description}` : "—",
      conversation: conversation.conversationId ? `n° ${conversation.conversationId}` : "Nouvelle",
      messages: String(conversation.messageCount),
    });
  }

  async function updateVoiceContext(preferences = getPreferences()) {
    if (!isSpeechSynthesisSupported()) {
      contextPanel.update({ voice: "Non disponible", "voice-language": "—" });
    } else {
      const { description } = await resolveVoice(preferences);
      contextPanel.update({
        voice: description ? formatVoiceLabel(description) : "Voix par défaut du système",
        "voice-language": description ? description.languageLabel : "Aucune voix française",
      });
    }

    if (!isSpeechRecognitionSupported()) {
      contextPanel.update({ recognition: "Dictée non disponible (Chrome / Edge)" });
      return;
    }
    const onDevice = await getOnDeviceRecognitionStatus();
    contextPanel.update({ recognition: RECOGNITION_LABELS[onDevice] || "Dictée en ligne (navigateur)" });
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
    elements.sendButton.disabled = requestInProgress || !elements.input.value.trim();
    elements.characterCount.textContent = `${elements.input.value.length} / ${elements.input.maxLength}`;
  }

  function setBusy(isBusy) {
    requestInProgress = isBusy;
    elements.chatPanel.setAttribute("aria-busy", String(isBusy));
    elements.newConversationButton.disabled = isBusy;
    elements.composerSuggestions.classList.toggle("is-disabled", isBusy);
    devicePicker.setDisabled(isBusy);
    setStatus(isBusy ? "Le Copilote réfléchit…" : READY_STATUS, isBusy ? "processing" : "idle");
    updateComposerState();
  }

  /**
   * Envoie un message par le flux existant (conversationService -> POST /api/chat).
   * Ne lève jamais : renvoie { reply } ou { error } pour que le mode vocal puisse réagir.
   * @param {{ channel?: "text"|"voice", silent?: boolean, readReply?: boolean }} options
   *        silent = message déjà affiché (bouton "Réessayer")
   */
  async function submitMessage(text, { channel = "text", silent = false, readReply = true } = {}) {
    if (requestInProgress) return { error: new Error("Une réponse est déjà en cours de préparation.") };
    setBusy(true);
    const removeTyping = chatView.showTyping();
    let reply = null;
    let error = null;
    try {
      ({ text: reply } = await conversation.ask(text, { channel, silent }));
    } catch (caught) {
      error = caught;
      chatView.showError(getFriendlyErrorMessage(caught), () => void submitMessage(text, { channel, silent: true, readReply }));
    } finally {
      removeTyping();
      setBusy(false);
      nextUserAnimation = "up";
      updateContext();
    }
    if (reply && readReply && getPreferences().autoRead) void readAloud(reply);
    return { reply, error };
  }

  /* ---------- Bulles de suggestions ---------- */
  function renderSuggestions() {
    elements.composerSuggestions.replaceChildren(
      createSuggestionList({ deviceType: conversation.deviceType, onPick: pickSuggestion, className: "suggestion-list-compact" }),
    );
    chatView.refreshWelcomeExtras();
  }

  /** La bulle "monte" vers la conversation puis devient le message du technicien. */
  async function pickSuggestion(text, chip) {
    if (requestInProgress) return;
    dictation.cancel();
    stopReading();
    requestInProgress = true; // bloque un double clic pendant l'animation
    await flySuggestionToConversation(chip, elements.conversation);
    requestInProgress = false;
    nextUserAnimation = "landing";
    void submitMessage(text);
  }

  /* ---------- Événements du chat écrit ---------- */
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = elements.input.value.trim();
    if (!text || requestInProgress) return;
    dictation.cancel();
    playSendBurst(elements.form);
    elements.input.value = "";
    resizeInput();
    updateComposerState();
    void submitMessage(text);
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

  elements.newConversationButton.addEventListener("click", () => {
    if (requestInProgress) return;
    dictation.cancel();
    stopReading();
    void conversation.reset();
  });

  elements.logoutButton.addEventListener("click", async () => {
    dictation.cancel();
    stopReading();
    await logout();
    window.location.href = "/";
  });

  /* ---------- Synchronisation vue <-> conversation ---------- */
  // Tous les messages (écrits OU vocaux) arrivent par cet abonnement.
  conversation.subscribe((event) => {
    if (event.type === "message") {
      chatView.appendMessage(event.message, { userAnimation: nextUserAnimation });
      updateContext();
    }
    if (event.type === "reset") {
      chatView.reset();
      updateContext();
      elements.input.focus();
    }
  });
  onPreferencesChange(applyPreferences);
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.addEventListener("voiceschanged", () => void updateVoiceContext());
  }

  /* ---------- Démarrage : restauration de la conversation de l'onglet ---------- */
  applyPreferences(getPreferences());
  const restored = await conversation.restore();
  devicePicker.setValue(restored.deviceType);
  chatView.reset();
  restored.messages.forEach((message) => chatView.appendMessage(message, { animate: false }));
  renderSuggestions();
  updateContext();
  updateComposerState();
  setStatus(READY_STATUS);
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
