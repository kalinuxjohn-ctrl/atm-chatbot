import { requestJson } from "./apiClient.js";
import { createElementWithText } from "./domHelpers.js";
import { createIcon } from "./icons.js";

const POLL_INTERVAL = 10_000;
let storageKey = null;
let unreadCount = 0;
let polling = false;
let activeConversationId = null;
let memoryState = null;
let browserEnabledInMemory = false;
let alertElement = null;
let alertConversationId = null;
const browserNotifications = new Map();

function readStorage(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* Stockage privé : repli en mémoire. */ }
}

export function browserNotificationsEnabled() {
  return storageKey !== null && (readStorage(`${storageKey}:enabled`) === "true" || browserEnabledInMemory);
}

export async function setBrowserNotificationsEnabled(enabled) {
  if (!storageKey) return false;
  if (enabled) {
    if (!("Notification" in window) || !window.isSecureContext) return false;
    // Appelé uniquement par le bouton des paramètres, jamais par le polling.
    if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") return false;
  }
  browserEnabledInMemory = enabled;
  writeStorage(`${storageKey}:enabled`, String(enabled));
  return true;
}

/** Un premier échantillon ne produit jamais une rafale d'alertes d'historique. */
export function advanceNotificationState(previous, conversations) {
  const next = { ...(previous ?? {}) };
  const arrivals = [];
  for (const conversation of conversations) {
    const id = String(conversation.conversationId);
    const latest = Number(conversation.latestIncomingMessageId);
    if (previous !== null && latest > Number(previous[id] ?? 0) && conversation.unreadCount > 0) arrivals.push(conversation);
    next[id] = Math.max(Number(next[id] ?? 0), latest);
  }
  return { next, arrivals };
}

export function setReadingConversation(conversationId) {
  activeConversationId = conversationId;
}

function renderUnreadBadge() {
  for (const link of document.querySelectorAll('a[href="/messaging/"]')) {
    let badge = link.querySelector("[data-unread-badge]");
    if (!badge) {
      badge = createElementWithText("span", "counter-badge app-unread-badge");
      badge.dataset.unreadBadge = "";
      link.append(badge);
    }
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.hidden = unreadCount === 0;
    link.setAttribute("aria-label", unreadCount ? `Messagerie : ${unreadCount} message(s) non lu(s)` : "Messagerie");
  }
}

function showArrival(conversation) {
  if (activeConversationId === conversation.conversationId && !document.hidden && document.hasFocus()
    && !document.querySelector("dialog[open]")) return;
  const href = `/messaging/?conversationId=${conversation.conversationId}`;
  if (!alertElement) {
    alertElement = createElementWithText("aside", "app-message-alert");
    alertElement.setAttribute("aria-live", "polite");
    alertElement.setAttribute("aria-atomic", "true");
    document.body.append(alertElement);
  }
  const link = createElementWithText("a", "app-message-alert-link");
  link.href = href;
  const visual = createElementWithText("span", "app-message-alert-visual");
  visual.append(createIcon("message"));
  const content = createElementWithText("span", "app-message-alert-content");
  content.append(
    createElementWithText("strong", "app-message-alert-title", "Nouveau message"),
    createElementWithText("span", "app-message-alert-description", conversation.unreadCount > 1
      ? `${conversation.unreadCount} messages non lus dans cette conversation`
      : "Un collègue vous a envoyé un message"),
  );
  const action = createElementWithText("span", "app-message-alert-action", "Ouvrir la conversation");
  action.append(createIcon("chevronRight"));
  content.append(action);
  link.append(visual, content);
  const close = createElementWithText("button", "icon-button app-message-alert-close");
  close.append(createIcon("close"));
  close.type = "button";
  close.setAttribute("aria-label", "Fermer la notification");
  close.addEventListener("click", () => { alertElement.hidden = true; });
  alertElement.replaceChildren(link, close);
  alertConversationId = conversation.conversationId;
  alertElement.hidden = false;
  if (browserNotificationsEnabled() && "Notification" in window && Notification.permission === "granted") {
    try {
      // Pas de contenu ni de nom de collègue sur l'écran verrouillé.
      const notification = new Notification("Nouveau message", {
        body: "Vous avez reçu un message dans la messagerie.",
        icon: `${window.location.origin}/shared/images/message-notification.svg`,
        tag: `main-app-message-${conversation.conversationId}`,
      });
      browserNotifications.get(conversation.conversationId)?.close();
      browserNotifications.set(conversation.conversationId, notification);
      notification.onclick = () => {
        window.focus();
        window.location.assign(href);
        notification.close();
      };
    } catch { /* Certains navigateurs mobiles n'acceptent pas ce constructeur. */ }
  }
}

async function consumeState(conversations) {
  let previous = memoryState;
  try {
    const saved = JSON.parse(readStorage(storageKey));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) previous = saved;
  } catch { /* Préférence corrompue : repartir sans alerte historique. */ }
  const { next, arrivals } = advanceNotificationState(previous, conversations);
  memoryState = next;
  writeStorage(storageKey, JSON.stringify(next));
  for (const conversation of arrivals) showArrival(conversation);
}

export async function refreshMessageNotifications() {
  if (!storageKey || polling) return;
  polling = true;
  try {
    const { conversations } = await requestJson("/api/messaging/notifications");
    unreadCount = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
    renderUnreadBadge();
    const unreadConversationIds = new Set(conversations.filter((conversation) => conversation.unreadCount > 0)
      .map((conversation) => conversation.conversationId));
    if (alertElement && !unreadConversationIds.has(alertConversationId)) alertElement.hidden = true;
    for (const [conversationId, notification] of browserNotifications) {
      if (!unreadConversationIds.has(conversationId)) {
        notification.close();
        browserNotifications.delete(conversationId);
      }
    }
    // Le verrou inter-onglets couvre lecture + écriture du curseur + alerte.
    if (navigator.locks?.request) {
      await navigator.locks.request(storageKey, () => consumeState(conversations));
    } else {
      await consumeState(conversations);
    }
  } catch {
    // Une coupure réseau ne remet pas les compteurs ou les curseurs à zéro.
  } finally {
    polling = false;
  }
}

export function startMessageNotifications(user) {
  if (!user || storageKey) return;
  storageKey = `main-app-notifications:${user.technicianId}`;
  refreshMessageNotifications();
  // L'application doit rester ouverte ; les onglets cachés peuvent être ralentis par le navigateur.
  setInterval(refreshMessageNotifications, POLL_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshMessageNotifications();
  });
  window.addEventListener("focus", refreshMessageNotifications);
  window.addEventListener("main-app:messages-read", refreshMessageNotifications);
  window.addEventListener("main-app:shell-rendered", renderUnreadBadge);
  window.addEventListener("storage", (event) => {
    if (event.key === `${storageKey}:enabled`) browserEnabledInMemory = event.newValue === "true";
  });
}
