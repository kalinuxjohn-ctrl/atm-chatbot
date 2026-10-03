/**
 * Page Diagnostic : recherche directe d'un symptôme dans l'historique.
 * ✅ API réelle : POST /chat/search-symptom (services/api/symptomApi.js).
 * (Anciennement js/chat.js, comportement inchangé.)
 */

import {
  appendAssistantMessage,
  appendUserMessage,
  createTypingIndicator,
  resetConversation,
  scrollConversationToBottom,
} from "../components/diagnosticView.js";
import { getFriendlyErrorMessage } from "../core/httpClient.js";
import { searchSymptoms } from "../services/api/symptomApi.js";
import { formatTime } from "../utils/dom.js";

const conversation = document.querySelector("#conversation");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const deviceTypeInput = document.querySelector("#device-type");
const sendButton = document.querySelector("#send-button");
const characterCount = document.querySelector("#character-count");
const newSearchButton = document.querySelector("#new-search-button");
const chatPanel = document.querySelector(".chat-panel");
let requestInProgress = false;

/* ---------- État du formulaire ---------- */

function updateComposerState() {
  sendButton.disabled = requestInProgress || !messageInput.value.trim();
  characterCount.textContent = `${messageInput.value.length} / ${messageInput.maxLength}`;
  messageInput.setAttribute("aria-describedby", "character-count");
}

function setBusy(isBusy) {
  requestInProgress = isBusy;
  chatPanel.setAttribute("aria-busy", String(isBusy));
  deviceTypeInput.disabled = isBusy;
  newSearchButton.disabled = isBusy;
  updateComposerState();
}

/* ---------- Recherche ---------- */

/** includeUserMessage = false lors d'un nouvel essai (message déjà affiché). */
async function submitSearch(rawText, deviceType, { includeUserMessage = true } = {}) {
  if (requestInProgress) return;
  setBusy(true);
  if (includeUserMessage) appendUserMessage(conversation, rawText, deviceType, formatTime());
  const typingIndicator = createTypingIndicator(conversation, formatTime());
  newSearchButton.hidden = false;
  scrollConversationToBottom(conversation);

  const retry = () => submitSearch(rawText, deviceType, { includeUserMessage: false });
  try {
    const result = await searchSymptoms(rawText, deviceType);
    typingIndicator.remove();
    appendAssistantMessage(conversation, result, { onRetry: retry });
  } catch (error) {
    typingIndicator.remove();
    appendAssistantMessage(conversation, null, { errorMessage: getFriendlyErrorMessage(error), onRetry: retry });
  } finally {
    setBusy(false);
    scrollConversationToBottom(conversation);
  }
}

/* ---------- Événements ---------- */

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const rawText = messageInput.value.trim();
  if (!rawText || requestInProgress) return;
  const deviceType = deviceTypeInput.value;
  messageInput.value = "";
  messageInput.style.height = "";
  updateComposerState();
  void submitSearch(rawText, deviceType);
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 140)}px`;
  updateComposerState();
});

// Entrée = envoyer, Maj + Entrée = nouvelle ligne.
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!sendButton.disabled) messageForm.requestSubmit();
  }
});

newSearchButton.addEventListener("click", () => {
  if (requestInProgress) return;
  resetConversation(conversation);
  newSearchButton.hidden = true;
  messageInput.value = "";
  messageInput.style.height = "";
  deviceTypeInput.value = "gab";
  updateComposerState();
  messageInput.focus();
});

updateComposerState();
