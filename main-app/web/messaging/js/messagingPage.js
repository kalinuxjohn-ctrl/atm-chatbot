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
import { createAvatar, createElementWithText, formatDayLabel, formatTime } from "/shared/js/domHelpers.js";
import { setReadingConversation } from "/shared/js/messageNotifications.js";

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
const threadHeader = document.querySelector("[data-thread-header]");
const threadAvatar = document.querySelector("[data-thread-avatar]");
const threadTitle = document.querySelector("[data-thread-title]");
const threadEmptyState = document.querySelector("[data-thread-empty-state]");
const messageList = document.querySelector("[data-message-list]");
const threadError = document.querySelector("[data-thread-error]");
const messageComposer = document.querySelector("[data-message-composer]");
const imageInput = document.querySelector("[data-image-input]");
const recordVoiceButton = document.querySelector("[data-record-voice]");
const recordingIndicator = document.querySelector("[data-recording-indicator]");

/** Conversation affichée. lastDisplayedDay : jour du dernier message, pour placer les séparateurs « Aujourd'hui », « Hier »… */
const openConversation = { conversationId: null, lastDisplayedMessageId: 0, lastDisplayedDay: null, isPolling: false };
let voiceRecording = null;
let lastLoadedConversations = [];
let pollingErrorIsShown = false;
const acknowledgedMessages = new Map();
let readReceiptPending = false;

function showThreadError(message) {
  threadError.textContent = message;
  threadError.hidden = !message;
}

/**
 * Échec d'un cycle de polling (service redémarré, réseau coupé) : affiché pour
 * que l'utilisateur sache pourquoi rien n'arrive, puis retiré au premier cycle
 * réussi. Une erreur d'envoi, elle, reste affichée.
 */
function showPollingError(error) {
  showThreadError(error.message);
  pollingErrorIsShown = true;
}

function clearPollingError() {
  if (pollingErrorIsShown) {
    showThreadError("");
    pollingErrorIsShown = false;
  }
}

// --- Liste des conversations -------------------------------------------------

async function reloadConversationList() {
  let conversations;
  try {
    ({ conversations } = await requestJson("/api/messaging/conversations"));
  } catch (error) {
    showPollingError(error);
    return;
  }
  clearPollingError();
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
    return `${prefix}Photo`;
  }
  if (lastMessage.kind === "audio") {
    return `${prefix}Message vocal`;
  }
  return `${prefix}${lastMessage.textPreview}`;
}

/** Heure du dernier message si c'est aujourd'hui, sinon « Hier » ou la date courte. */
function formatConversationTime(isoDateText) {
  if (!isoDateText) {
    return "";
  }
  const dayLabel = formatDayLabel(isoDateText);
  if (dayLabel === "Aujourd'hui") {
    return formatTime(isoDateText);
  }
  return dayLabel === "Hier" ? dayLabel : new Date(isoDateText).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function createConversationListItem(conversation) {
  const listItem = document.createElement("li");
  const hasUnreadMessages = conversation.unreadMessageCount > 0;
  const openButton = createElementWithText("button", hasUnreadMessages ? "conversation-list-item conversation-list-item-unread" : "conversation-list-item");
  openButton.type = "button";
  if (conversation.id === openConversation.conversationId) {
    openButton.setAttribute("aria-current", "true");
  }
  const otherUsername = conversation.otherParticipant?.username ?? "Ancien utilisateur";
  const topLine = createElementWithText("span", "conversation-list-item-top");
  topLine.append(
    createElementWithText("span", "conversation-list-item-name", otherUsername),
    createElementWithText("span", "conversation-list-item-time", formatConversationTime(conversation.lastMessageAt)),
  );
  const bottomLine = createElementWithText("span", "conversation-list-item-bottom");
  bottomLine.append(createElementWithText("span", "conversation-list-item-preview", describeLastMessage(conversation.lastMessage)));
  if (hasUnreadMessages) {
    const unreadBadge = createElementWithText("span", "counter-badge", String(conversation.unreadMessageCount));
    unreadBadge.setAttribute("aria-label", `${conversation.unreadMessageCount} non lu(s)`);
    bottomLine.append(unreadBadge);
  }
  const textBlock = createElementWithText("span", "conversation-list-item-text");
  textBlock.append(topLine, bottomLine);
  openButton.append(createAvatar(otherUsername), textBlock);
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
        const startButton = createElementWithText("button", "contact-result-item");
        startButton.type = "button";
        startButton.append(createAvatar(contact.username, { sizeClassName: "avatar-small" }), createElementWithText("span", "", contact.username));
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
  setReadingConversation(null);
  openConversation.conversationId = conversationId;
  openConversation.lastDisplayedMessageId = 0;
  openConversation.lastDisplayedDay = null;
  threadTitle.textContent = otherUsername;
  threadAvatar.replaceChildren(createAvatar(otherUsername));
  threadHeader.hidden = false;
  threadEmptyState.hidden = true;
  messageList.replaceChildren();
  showThreadError("");
  messageComposer.hidden = false;
  messagingLayout.dataset.view = "thread";
  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.set("conversationId", String(conversationId));
  window.history.replaceState(null, "", pageUrl);
  await fetchNewMessages();
  messageComposer.elements.text.focus();
  acknowledgeVisibleMessages();
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
    clearPollingError();
    // La conversation a pu changer pendant la requête : on ignore une réponse périmée.
    if (conversationId === openConversation.conversationId) {
      appendMessages(messages);
      acknowledgeVisibleMessages();
    }
  } catch (error) {
    showPollingError(error);
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
  for (const message of newMessages) {
    const messageDay = new Date(message.createdAt).toDateString();
    if (messageDay !== openConversation.lastDisplayedDay) {
      messageList.append(createElementWithText("li", "message-day-separator", formatDayLabel(message.createdAt)));
      openConversation.lastDisplayedDay = messageDay;
    }
    messageList.append(createMessageBubble(message));
  }
  openConversation.lastDisplayedMessageId = newMessages.at(-1).id;
  if (wasScrolledToBottom || newMessages.some((message) => message.isOwnMessage)) {
    messageList.scrollTop = messageList.scrollHeight;
  }
  showThreadError("");
  acknowledgeVisibleMessages();
}

/** Un message chargé n'est pas forcément lu : onglet actif, fil visible et bas du fil atteint. */
async function acknowledgeVisibleMessages() {
  const { conversationId, lastDisplayedMessageId } = openConversation;
  const reading = conversationId && !document.hidden && document.hasFocus()
    && !document.querySelector("dialog[open]") && messageList.getClientRects().length > 0
    && messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 60;
  setReadingConversation(reading ? conversationId : null);
  if (!reading || !lastDisplayedMessageId || readReceiptPending
    || lastDisplayedMessageId <= (acknowledgedMessages.get(conversationId) ?? 0)) return;
  readReceiptPending = true;
  try {
    await requestJson(`/api/messaging/conversations/${conversationId}/read`, {
      method: "POST",
      body: { lastReadMessageId: lastDisplayedMessageId },
    });
    acknowledgedMessages.set(conversationId, lastDisplayedMessageId);
    window.dispatchEvent(new Event("main-app:messages-read"));
    reloadConversationList();
  } catch {
    // Réessayer au prochain polling / retour sur le fil, sans effacer le badge localement.
  } finally {
    readReceiptPending = false;
  }
}

messageList.addEventListener("scroll", acknowledgeVisibleMessages);
document.addEventListener("visibilitychange", acknowledgeVisibleMessages);
document.addEventListener("focusin", acknowledgeVisibleMessages);
window.addEventListener("focus", acknowledgeVisibleMessages);
window.addEventListener("blur", () => setReadingConversation(null));
window.addEventListener("resize", acknowledgeVisibleMessages);

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
  // Conversation à deux : le côté de la bulle dit déjà qui écrit, l'heure suffit.
  const messageTime = createElementWithText("time", "message-meta", formatTime(message.createdAt));
  messageTime.dateTime = message.createdAt;
  bubble.append(messageTime);
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
    const conversationId = openConversation.conversationId;
    const { message } = await requestJson(`/api/messaging/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { text },
    });
    if (conversationId === openConversation.conversationId) {
      textArea.value = "";
      fitComposerToText();
      appendMessages([message]);
    }
    reloadConversationList(); // aperçu du dernier message à jour sans attendre le prochain cycle
  } catch (error) {
    showThreadError(error.message);
  }
}

async function sendAttachment(fileOrBlob, fileName) {
  const formData = new FormData();
  formData.append("file", fileOrBlob, fileName);
  try {
    const conversationId = openConversation.conversationId;
    const { message } = await requestJson(`/api/messaging/conversations/${conversationId}/attachments`, {
      method: "POST",
      body: formData,
    });
    if (conversationId === openConversation.conversationId) appendMessages([message]);
    reloadConversationList();
  } catch (error) {
    showThreadError(error.message);
  }
}

/** La zone de saisie grandit avec le texte (jusqu'au max-height du CSS), puis défile. */
function fitComposerToText() {
  const textArea = messageComposer.elements.text;
  textArea.style.height = "auto";
  textArea.style.height = `${textArea.scrollHeight}px`;
}
messageComposer.elements.text.addEventListener("input", fitComposerToText);

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
  setReadingConversation(null);
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
