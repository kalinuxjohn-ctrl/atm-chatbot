/**
 * Affichage de la conversation du Copilote (chat écrit + échanges vocaux).
 * Ne fait AUCUN appel réseau : il reçoit des messages et les dessine.
 */

import { createElement, formatTime, prefersReducedMotion } from "../utils/dom.js";
import { renderAvatar } from "./avatar.js";
import { createIcon } from "./icons.js";

const GREETING = [
  "Bonjour, je suis votre Copilote de maintenance.",
  "Décrivez le problème observé sur le GAB ou le TPE, à l’écrit ou au micro, ou choisissez un cas fréquent ci-dessous.",
];

/**
 * @param {{
 *   conversationElement: HTMLElement,
 *   getAvatarKind: () => string,
 *   onListen: (text: string) => void,                 bouton "Écouter" d'une réponse
 *   createWelcomeExtras?: () => Node | null,          ex. bulles de suggestions du message d'accueil
 * }} options
 */
export function createChatView({ conversationElement, getAvatarKind, onListen, createWelcomeExtras = () => null }) {
  let welcomeExtrasSlot = null;

  const scrollToBottom = () => {
    conversationElement.scrollTo({
      top: conversationElement.scrollHeight,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  function createAvatarSlot() {
    const slot = createElement("span", "message-avatar copilot-avatar-slot");
    slot.setAttribute("aria-hidden", "true");
    slot.append(renderAvatar(getAvatarKind()));
    return slot;
  }

  function createAuthor(label, time, icon) {
    const author = createElement("span", "message-author");
    if (icon) author.append(createIcon(icon, "icon message-author-icon"));
    author.append(createElement("span", "", label), createElement("time", "", time));
    return author;
  }

  function createAssistantShell(time) {
    const message = createElement("article", "message assistant-message message-enter-fade");
    const body = createElement("div", "message-body");
    body.append(createAuthor("ATM-Chatbot", time));
    message.append(createAvatarSlot(), body);
    return { message, body };
  }

  /** Un paragraphe par ligne non vide : le LLM renvoie souvent du texte multi-lignes. */
  function createTextBubble(text) {
    const bubble = createElement("div", "message-bubble");
    text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => bubble.append(createElement("p", "", line)));
    return bubble;
  }

  /** animation : "up" (envoi classique) | "landing" (après la montée d'une bulle) | false */
  function appendUser({ text, channel, time }, { animate = "up" } = {}) {
    const animationClass = animate ? ` message-enter-${animate}` : "";
    const message = createElement("article", `message user-message${animationClass}`);
    const body = createElement("div", "message-body");
    body.append(
      createAuthor(channel === "voice" ? "Vous · vocal" : "Vous", time, channel === "voice" ? "mic" : null),
      createTextBubble(text),
    );
    message.append(body);
    conversationElement.append(message);
    scrollToBottom();
  }

  function appendAssistant({ text, channel, time }, { animate = true } = {}) {
    const { message, body } = createAssistantShell(time);
    if (!animate) message.classList.remove("message-enter-fade");
    body.append(createTextBubble(text));

    const listenButton = createElement("button", "message-listen-button");
    listenButton.type = "button";
    listenButton.append(createIcon("speaker"), createElement("span", "", "Écouter"));
    listenButton.setAttribute("aria-label", "Écouter cette réponse");
    listenButton.addEventListener("click", () => onListen(text));
    body.append(listenButton);

    if (channel === "voice") message.classList.add("voice-exchange");
    conversationElement.append(message);
    scrollToBottom();
  }

  function renderWelcomeExtras() {
    if (!welcomeExtrasSlot) return;
    const extras = createWelcomeExtras();
    welcomeExtrasSlot.replaceChildren(...(extras ? [extras] : []));
  }

  return {
    /** Affiche un message enregistré (conversationService). */
    appendMessage(message, options = {}) {
      if (message.role === "user") appendUser(message, { animate: options.animate === false ? false : options.userAnimation || "up" });
      else appendAssistant(message, options);
    },

    /** Indicateur "le Copilote réfléchit" ; renvoie la fonction qui le retire. */
    showTyping() {
      const { message, body } = createAssistantShell(formatTime());
      const indicator = createElement("div", "typing-indicator");
      indicator.setAttribute("role", "status");
      indicator.setAttribute("aria-label", "Le Copilote prépare sa réponse");
      for (let index = 0; index < 3; index += 1) indicator.append(createElement("span"));
      body.append(indicator);
      conversationElement.append(message);
      scrollToBottom();
      return () => message.remove();
    },

    showError(errorMessage, onRetry) {
      const { message, body } = createAssistantShell(formatTime());
      const card = createElement("div", "friendly-error");
      card.setAttribute("role", "alert");
      card.append(createElement("strong", "", "Un problème est survenu"), createElement("span", "", errorMessage));
      const retryButton = createElement("button", "retry-button");
      retryButton.type = "button";
      retryButton.append(createIcon("refresh"), createElement("span", "", "Réessayer"));
      retryButton.addEventListener(
        "click",
        () => {
          message.remove();
          onRetry();
        },
        { once: true },
      );
      body.append(card, retryButton);
      conversationElement.append(message);
      scrollToBottom();
    },

    /** Vide le fil et réaffiche le message d'accueil (avec ses suggestions). */
    reset() {
      const { message, body } = createAssistantShell("À l’instant");
      message.classList.remove("message-enter-fade");
      message.classList.add("welcome-message");
      welcomeExtrasSlot = createElement("div", "welcome-extras");
      body.append(createTextBubble(GREETING.join("\n")), welcomeExtrasSlot);
      conversationElement.replaceChildren(message);
      renderWelcomeExtras();
    },

    /** Redessine les suggestions du message d'accueil (ex. changement GAB / TPE). */
    refreshWelcomeExtras: renderWelcomeExtras,

    /** Change l'avatar de tous les messages déjà affichés (après un changement de paramètres). */
    refreshAvatars() {
      conversationElement.querySelectorAll(".copilot-avatar-slot").forEach((slot) => {
        slot.replaceChildren(renderAvatar(getAvatarKind()));
      });
    },
  };
}

/**
 * Animation d'envoi : petites bulles qui s'échappent du champ de saisie.
 * Courte (≈ 600 ms) pour ne jamais ralentir le technicien.
 */
export function playSendBurst(container) {
  if (prefersReducedMotion()) return;
  const BUBBLE_COUNT = 10;
  for (let index = 0; index < BUBBLE_COUNT; index += 1) {
    const bubble = createElement("span", "send-bubble");
    const angle = (Math.PI * 2 * index) / BUBBLE_COUNT + Math.random() * 0.5;
    const distance = 28 + Math.random() * 30;
    bubble.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    bubble.style.setProperty("--dy", `${Math.sin(angle) * distance - 18}px`);
    bubble.style.setProperty("--size", `${4 + Math.random() * 6}px`);
    bubble.style.left = `${55 + Math.random() * 35}%`;
    bubble.style.top = `${30 + Math.random() * 40}%`;
    bubble.addEventListener("animationend", () => bubble.remove(), { once: true });
    container.append(bubble);
  }
}
