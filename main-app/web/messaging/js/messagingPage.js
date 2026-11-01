/**
 * Page Messagerie.
 *
 * - Envoi : POST au backend (texte, photo ou message vocal).
 * - Réception : polling, toutes les 3 s pour la conversation ouverte et
 *   toutes les 10 s pour la liste, mis en pause quand l'onglet est caché.
 *   Le curseur est l'id du dernier message affiché (?after=).
 * - Anti-XSS : chaque texte est inséré avec textContent. Un message
 *   « <script>…</script> » s'affiche tel quel, en caractères ; les emojis aussi.
 */

import { requestJson } from "/shared/js/apiClient.js";
import "/shared/js/connectedPageShell.js";
import { createElementWithText, formatDateTime } from "/shared/js/domHelpers.js";

const OPEN_CONVERSATION_POLL_MILLISECONDS = 3_000;
const CONVERSATION_LIST_POLL_MILLISECONDS = 10_000;
const MAXIMUM_VOICE_MESSAGE_MILLISECONDS = 2 * 60 * 1000;
// Format d'enregistrement préféré, selon ce que le navigateur sait produire.
const VOICE_RECORDING_MEDIA_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

const messagingLayout = document.querySelector("[data-messaging-layout]");
const conversationList = document.querySelector("[data-conversation-list]");
const conversationListEmpty = document.querySelector("[data-conversation-list-empty]");
const contactSearchForm = document.querySelector("[data-contact-search-form]");
const contactResults = document.querySelector("[data-contact-results]");
const threadTitle = document.querySelector("[data-thread-title]");
const messageList = document.querySelector("[data-message-list]");
const threadError = document.querySelector("[data-thread-error]");
const messageComposer = document.querySelector("[data-message-composer]");
const imageInput = document.querySelector("[data-image-input]");
const recordVoiceButton = document.querySelector("[data-record-voice]");
const recordingIndicator = document.querySelector("[data-recording-indicator]");

const openConversation = { conversationId: null, lastDisplayedMessageId: 0, isPolling: false };
let voiceRecording = null;
let lastLoadedConversations = [];

function showThreadError(message) {
  threadError.textContent = message;
  threadError.hidden = !message;
}

// --- Liste des conversations -------------------------------------------------

async function reloadConversationList() {
  let conversations;
  try {
    ({ conversations } = await requestJson("/api/messaging/conversations"));
  } catch {
    return; // nouvelle tentative au prochain cycle
  }
  lastLoadedConversations = conversations;
  conversationListEmpty.hidden = conversations.length > 0;
  conversationList.replaceChildren(...conversations.map(createConversationListItem));
}

function describeLastMessage(lastMessage) {
  if (!lastMessage) {
    return "Aucun message";
  }
  const prefix = lastMessage.isOwnMessage ? "Vous : " : "";
  if (lastMessage.kind === "image") {
    return `${prefix}📷 Photo`;
  }
  if (lastMessage.kind === "audio") {
    return `${prefix}🎙️ Message vocal`;
  }
  return `${prefix}${lastMessage.textPreview}`;
}

function createConversationListItem(conversation) {
  const listItem = document.createElement("li");
  const openButton = createElementWithText("button", "conversation-list-item");
  openButton.type = "button";
  if (conversation.id === openConversation.conversationId) {
    openButton.setAttribute("aria-current", "true");
  }
  const otherUsername = conversation.otherParticipant?.username ?? "Ancien utilisateur";
  const textBlock = createElementWithText("span", "conversation-list-item-text");
  textBlock.append(
    createElementWithText("span", "conversation-list-item-name", otherUsername),
    createElementWithText("span", "conversation-list-item-preview", describeLastMessage(conversation.lastMessage)),
  );
  openButton.append(textBlock);
  if (conversation.unreadMessageCount > 0 && conversation.id !== openConversation.conversationId) {
    openButton.append(createElementWithText("span", "unread-badge", String(conversation.unreadMessageCount)));
  }
  openButton.addEventListener("click", () => openConversationThread(conversation.id, otherUsername));
  listItem.append(openButton);
  return listItem;
}

// --- Recherche d'un collègue -------------------------------------------------

let contactSearchTimer = null;
contactSearchForm.elements.search.addEventListener("input", () => {
  clearTimeout(contactSearchTimer);
  contactSearchTimer = setTimeout(searchContacts, 250);
});
contactSearchForm.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();
  searchContacts();
});

async function searchContacts() {
  const searchText = contactSearchForm.elements.search.value.trim();
  if (!searchText) {
    contactResults.hidden = true;
    return;
  }
  try {
    const { contacts } = await requestJson(`/api/messaging/contacts?${new URLSearchParams({ search: searchText })}`);
    contactResults.replaceChildren(
      ...contacts.map((contact) => {
        const listItem = document.createElement("li");
        const startButton = createElementWithText("button", "contact-result-item", contact.username);
        startButton.type = "button";
        startButton.addEventListener("click", () => startConversationWith(contact));
        listItem.append(startButton);
        return listItem;
      }),
    );
    if (contacts.length === 0) {
      contactResults.replaceChildren(createElementWithText("li", "muted contact-result-item", "Aucun résultat"));
    }
    contactResults.hidden = false;
  } catch (error) {
    showThreadError(error.message);
  }
}

async function startConversationWith(contact) {
  try {
    const { conversationId } = await requestJson("/api/messaging/conversations", {
      method: "POST",
      body: { participantTechnicianId: contact.technicianId },
    });
    contactSearchForm.reset();
    contactResults.hidden = true;
    await openConversationThread(conversationId, contact.username);
    await reloadConversationList();
  } catch (error) {
    showThreadError(error.message);
  }
}

// --- Fil de la conversation ouverte --------------------------------------------

async function openConversationThread(conversationId, otherUsername) {
  openConversation.conversationId = conversationId;
  openConversation.lastDisplayedMessageId = 0;
  threadTitle.textContent = otherUsername;
  messageList.replaceChildren();
  showThreadError("");
  messageComposer.hidden = false;
  messagingLayout.dataset.view = "thread";
  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.set("conversationId", String(conversationId));
  window.history.replaceState(null, "", pageUrl);
  await fetchNewMessages();
  messageComposer.elements.text.focus();
}

async function fetchNewMessages() {
  const { conversationId, lastDisplayedMessageId } = openConversation;
  if (!conversationId || openConversation.isPolling) {
    return;
  }
  openConversation.isPolling = true;
  try {
    const cursor = lastDisplayedMessageId > 0 ? `?after=${lastDisplayedMessageId}` : "";
    const { messages } = await requestJson(`/api/messaging/conversations/${conversationId}/messages${cursor}`);
    // La conversation a pu changer pendant la requête : on ignore une réponse périmée.
    if (conversationId === openConversation.conversationId) {
      appendMessages(messages);
    }
  } catch (error) {
    showThreadError(error.message);
  } finally {
    openConversation.isPolling = false;
  }
}

function appendMessages(messages) {
  const newMessages = messages.filter((message) => message.id > openConversation.lastDisplayedMessageId);
  if (newMessages.length === 0) {
    return;
  }
  const wasScrolledToBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 60;
  messageList.append(...newMessages.map(createMessageBubble));
  openConversation.lastDisplayedMessageId = newMessages.at(-1).id;
  if (wasScrolledToBottom || newMessages.some((message) => message.isOwnMessage)) {
    messageList.scrollTop = messageList.scrollHeight;
  }
  showThreadError("");
  requestJson(`/api/messaging/conversations/${openConversation.conversationId}/read`, {
    method: "POST",
    body: { lastReadMessageId: openConversation.lastDisplayedMessageId },
  }).catch(() => {});
}

function createMessageBubble(message) {
  const bubble = createElementWithText("li", message.isOwnMessage ? "message-bubble message-bubble-own" : "message-bubble");
  if (message.attachment?.mediaType.startsWith("image/")) {
    const image = document.createElement("img");
    image.className = "message-image";
    image.src = message.attachment.url; // URL construite par le serveur, même origine
    image.alt = message.text || `Photo de ${message.sender.username}`;
    image.loading = "lazy";
    bubble.append(image);
  }
  if (message.attachment?.mediaType.startsWith("audio/")) {
    const audioPlayer = document.createElement("audio");
    audioPlayer.className = "message-audio";
    audioPlayer.controls = true;
    audioPlayer.preload = "metadata";
    audioPlayer.src = message.attachment.url;
    bubble.append(audioPlayer);
  }
  if (message.text) {
    bubble.append(createElementWithText("p", "message-text", message.text));
  }
  const authorLabel = message.isOwnMessage ? "Vous" : message.sender.username;
  bubble.append(createElementWithText("span", "message-meta", `${authorLabel} · ${formatDateTime(message.createdAt)}`));
  return bubble;
}

// --- Envoi -------------------------------------------------------------------

async function sendTextMessage() {
  const textArea = messageComposer.elements.text;
  const text = textArea.value;
  if (!text.trim() || !openConversation.conversationId) {
    return;
  }
  try {
    const { message } = await requestJson(`/api/messaging/conversations/${openConversation.conversationId}/messages`, {
      method: "POST",
      body: { text },
    });
    textArea.value = "";
    appendMessages([message]);
  } catch (error) {
    showThreadError(error.message);
  }
}

async function sendAttachment(fileOrBlob, fileName) {
  const formData = new FormData();
  formData.append("file", fileOrBlob, fileName);
  try {
    const { message } = await requestJson(`/api/messaging/conversations/${openConversation.conversationId}/attachments`, {
      method: "POST",
      body: formData,
    });
    appendMessages([message]);
  } catch (error) {
    showThreadError(error.message);
  }
}

messageComposer.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();
  sendTextMessage();
});
// Entrée envoie ; Maj + Entrée va à la ligne.
messageComposer.elements.text.addEventListener("keydown", (keyboardEvent) => {
  if (keyboardEvent.key === "Enter" && !keyboardEvent.shiftKey && !keyboardEvent.isComposing) {
    keyboardEvent.preventDefault();
    sendTextMessage();
  }
});
document.querySelector("[data-pick-image]").addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", () => {
  const [pickedImage] = imageInput.files;
  imageInput.value = "";
  if (pickedImage) {
    sendAttachment(pickedImage, "photo");
  }
});

// --- Message vocal (MediaRecorder) ------------------------------------------

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    showThreadError("L'enregistrement vocal n'est pas disponible sur ce navigateur.");
    return;
  }
  let microphoneStream;
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showThreadError("Micro inaccessible : autorisez le micro pour ce site.");
    return;
  }
  const mimeType = VOICE_RECORDING_MEDIA_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const mediaRecorder = new MediaRecorder(microphoneStream, mimeType ? { mimeType } : {});
  const recordedChunks = [];
  mediaRecorder.addEventListener("dataavailable", (dataEvent) => recordedChunks.push(dataEvent.data));
  mediaRecorder.addEventListener("stop", () => {
    microphoneStream.getTracks().forEach((track) => track.stop());
    const recordedVoice = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    if (recordedVoice.size > 0) {
      sendAttachment(recordedVoice, "message-vocal");
    }
  });
  mediaRecorder.start();
  voiceRecording = { mediaRecorder, stopTimer: setTimeout(stopVoiceRecording, MAXIMUM_VOICE_MESSAGE_MILLISECONDS) };
  recordVoiceButton.setAttribute("aria-pressed", "true");
  recordingIndicator.hidden = false;
}

function stopVoiceRecording() {
  if (!voiceRecording) {
    return;
  }
  clearTimeout(voiceRecording.stopTimer);
  voiceRecording.mediaRecorder.stop();
  voiceRecording = null;
  recordVoiceButton.setAttribute("aria-pressed", "false");
  recordingIndicator.hidden = true;
}

recordVoiceButton.addEventListener("click", () => (voiceRecording ? stopVoiceRecording() : startVoiceRecording()));

// --- Polling, en pause quand l'onglet est caché ---------------------------------

function startPolling() {
  setInterval(() => {
    if (!document.hidden) {
      fetchNewMessages();
    }
  }, OPEN_CONVERSATION_POLL_MILLISECONDS);
  setInterval(() => {
    if (!document.hidden) {
      reloadConversationList();
    }
  }, CONVERSATION_LIST_POLL_MILLISECONDS);
  // Retour sur l'onglet : rattrapage immédiat, sans attendre le prochain cycle.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      fetchNewMessages();
      reloadConversationList();
    }
  });
}

document.querySelector("[data-back-to-list]").addEventListener("click", () => {
  messagingLayout.dataset.view = "list";
});

// Lien direct vers une conversation (?conversationId=) : rouverte au chargement de la page.
await reloadConversationList();
const conversationIdFromUrl = Number(new URLSearchParams(window.location.search).get("conversationId"));
if (Number.isInteger(conversationIdFromUrl) && conversationIdFromUrl > 0) {
  const listedConversation = lastLoadedConversations.find((conversation) => conversation.id === conversationIdFromUrl);
  await openConversationThread(conversationIdFromUrl, listedConversation?.otherParticipant?.username ?? "Conversation");
  await reloadConversationList();
}
startPolling();
