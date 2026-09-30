import { ApiRequestError, searchSymptoms } from "./api.js";
import {
  appendAssistantMessage,
  appendUserMessage,
  createTypingIndicator,
  resetConversation,
  scrollConversationToBottom,
} from "./ui.js";

const conversation = document.querySelector("#conversation");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const deviceTypeInput = document.querySelector("#device-type");
const sendButton = document.querySelector("#send-button");
const characterCount = document.querySelector("#character-count");
const newSearchButton = document.querySelector("#new-search-button");
const chatPanel = document.querySelector(".chat-panel");
let requestInProgress = false;

function updateComposerState() {
  sendButton.disabled = requestInProgress || !messageInput.value.trim();
  characterCount.textContent = `${messageInput.value.length} / ${messageInput.maxLength}`;
  messageInput.setAttribute("aria-describedby", "character-count");
}

function formatTime() {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function setBusy(isBusy) {
  requestInProgress = isBusy;
  chatPanel.setAttribute("aria-busy", String(isBusy));
  deviceTypeInput.disabled = isBusy;
  newSearchButton.disabled = isBusy;
  updateComposerState();
}

function getFriendlyErrorMessage(error) {
  if (!(error instanceof ApiRequestError)) {
    console.error("Erreur inattendue dans le diagnostic.", error);
    return "Impossible de traiter votre demande pour le moment. Veuillez réessayer dans quelques instants.";
  }
  if (error.kind === "timeout") {
    return "L’analyse prend plus de temps que prévu. Vérifiez votre connexion et réessayez.";
  }
  if (error.kind === "network") {
    return "Impossible de joindre le service pour le moment. Vérifiez votre connexion et réessayez.";
  }
  return "Impossible de traiter votre demande pour le moment. Veuillez réessayer dans quelques instants.";
}

async function submitSearch(rawText, deviceType, { includeUserMessage = true } = {}) {
  if (requestInProgress) return;
  setBusy(true);
  if (includeUserMessage) appendUserMessage(conversation, rawText, deviceType, formatTime());
  const typingIndicator = createTypingIndicator(conversation, formatTime());
  newSearchButton.hidden = false;
  scrollConversationToBottom(conversation);

  try {
    const result = await searchSymptoms(rawText, deviceType);
    typingIndicator.remove();
    appendAssistantMessage(conversation, result, {
      onRetry: () => submitSearch(rawText, deviceType, { includeUserMessage: false }),
    });
  } catch (error) {
    typingIndicator.remove();
    appendAssistantMessage(conversation, null, {
      errorMessage: getFriendlyErrorMessage(error),
      onRetry: () => submitSearch(rawText, deviceType, { includeUserMessage: false }),
    });
  } finally {
    setBusy(false);
    scrollConversationToBottom(conversation);
  }
}

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
