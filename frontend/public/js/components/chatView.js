/**
 * Affichage de la conversation du Copilote (chat écrit + échanges vocaux).
 * Ne fait AUCUN appel réseau : il reçoit des messages et les dessine.
 */

import { createElement, formatTime, prefersReducedMotion } from "../utils/dom.js";
import { renderAvatar } from "./avatar.js";
import { createIcon } from "./icons.js";

/** Message d'accueil : titre personnalisé, puis la consigne. */
function greeting(userName) {
  return [
    userName ? `Bonjour ${userName} ! Comment puis-je vous aider ?` : "Bonjour ! Comment puis-je vous aider ?",
    "Décrivez le problème observé sur le GAB ou le TPE, à l’écrit ou au micro, ou choisissez un cas fréquent dans les menus de la zone de saisie.",
  ];
}

function createWelcomeReactor() {
  const reactor = createElement("div", "welcome-reactor");
  reactor.setAttribute("aria-hidden", "true");
  const scene = createElement("div", "reactor-scene");
  const heart = createElement("span", "reactor-heart");
  const gear = createElement("span", "reactor-gear");
  const teeth = [];
  for (let index = 0; index < 48; index += 1) {
    const angle = index / 48 * Math.PI * 2;
    const radius = index % 4 === 0 || index % 4 === 3 ? 42 : 50;
    teeth.push(`${50 + Math.cos(angle) * radius}% ${50 + Math.sin(angle) * radius}%`);
  }
  gear.style.clipPath = `polygon(${teeth.join(",")})`;
  heart.append(gear, createIcon("wrench"));
  scene.append(heart);
  for (let index = 0; index < 6; index += 1) {
    const plane = createElement("span", `reactor-filament-plane reactor-filament-plane-${index}`);
    plane.append(createElement("span", "reactor-filament"));
    scene.append(plane);
  }
  reactor.append(scene);
  return reactor;
}

/**
 * @param {{
 *   conversationElement: HTMLElement,
 *   userName?: string,                                prénom affiché dans le message d'accueil
 *   getAvatarKind: () => string,
 *   onListen: (text: string) => void,                 bouton "Écouter" d'une réponse
 *   createWelcomeExtras?: () => Node | null,          ex. bulles de suggestions du message d'accueil
 *   onProposeSolution?: () => void,                   « Proposer une solution » (sous une réponse avec solutions)
 * }} options
 */
export function createChatView({
  conversationElement,
  userName = "",
  getAvatarKind,
  onListen,
  createWelcomeExtras = () => null,
  onProposeSolution = () => {},
}) {
  let welcomeExtrasSlot = null;
  // Une seule offre de proposition à la fois : sous la DERNIÈRE réponse qui
  // contenait des solutions (le backend relit de toute façon le problème actif).
  let activeProposalOffer = null;
  // Position de la zone de saisie au moment de l'envoi : le prochain message
  // du technicien s'envole depuis là (voir flyIntoPlace).
  let pendingLaunch = null;

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

    const launchOrigin = pendingLaunch;
    pendingLaunch = null;
    if (animate && launchOrigin && !prefersReducedMotion()) {
      message.classList.remove(`message-enter-${animate}`);
      // Défilement immédiat : la bulle doit être à sa place définitive avant l'envol.
      conversationElement.scrollTop = conversationElement.scrollHeight;
      flyIntoPlace(message.querySelector(".message-bubble"), launchOrigin);
      return;
    }
    scrollToBottom();
  }

  /**
   * Deux étapes, pour ne pas pousser à proposer trop tôt :
   * « Aucune de ces solutions ne fonctionne » -> « + Proposer une solution ».
   */
  function createProposalOffer() {
    const offer = createElement("div", "proposal-offer");
    const noneWorkedButton = createElement("button", "proposal-offer-button");
    noneWorkedButton.type = "button";
    noneWorkedButton.append(createIcon("alert"), createElement("span", "", "Aucune de ces solutions ne fonctionne"));
    noneWorkedButton.addEventListener(
      "click",
      () => {
        const hint = createElement(
          "p",
          "proposal-offer-hint",
          "Vous avez trouvé ce qui marche ? Partagez-le : après validation, il aidera les prochains techniciens.",
        );
        const proposeButton = createElement("button", "proposal-offer-button is-primary");
        proposeButton.type = "button";
        proposeButton.append(createIcon("plus"), createElement("span", "", "Proposer une solution"));
        proposeButton.addEventListener("click", () => onProposeSolution());
        offer.replaceChildren(hint, proposeButton);
        proposeButton.focus();
      },
      { once: true },
    );
    offer.append(noneWorkedButton);
    return offer;
  }

  function dismissProposalOffer() {
    activeProposalOffer?.remove();
    activeProposalOffer = null;
  }

  function appendAssistant({ text, channel, time, canProposeSolution = false }, { animate = true } = {}) {
    const { message, body } = createAssistantShell(time);
    if (!animate) message.classList.remove("message-enter-fade");
    body.append(createTextBubble(text));

    const listenButton = createElement("button", "message-listen-button");
    listenButton.type = "button";
    listenButton.append(createIcon("speaker"), createElement("span", "", "Écouter"));
    listenButton.setAttribute("aria-label", "Écouter cette réponse");
    listenButton.addEventListener("click", () => onListen(text));
    body.append(listenButton);

    if (canProposeSolution) {
      dismissProposalOffer();
      activeProposalOffer = createProposalOffer();
      body.append(activeProposalOffer);
    }

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
    /** Le prochain message du technicien partira de ce rectangle (la zone de saisie). */
    launchNextUserMessage(originRect) {
      pendingLaunch = originRect;
    },

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

    /** Retire l'offre « Proposer une solution » (ex. après l'envoi d'une proposition). */
    dismissProposalOffer,

    /** Vide le fil et réaffiche le message d'accueil (avec ses suggestions). */
    reset() {
      activeProposalOffer = null;
      const { message, body } = createAssistantShell("À l’instant");
      message.classList.remove("message-enter-fade");
      message.classList.add("welcome-message");
      message.prepend(createWelcomeReactor());
      welcomeExtrasSlot = createElement("div", "welcome-extras");
      body.append(createTextBubble(greeting(userName).join("\n")), welcomeExtrasSlot);
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
 * Envol d'un message : une copie de la bulle part de la zone de saisie et
 * rejoint la vraie bulle (cachée pendant le vol), en suivant sa position à
 * chaque image (le fil peut encore bouger, ex. arrivée des points « réfléchit »).
 * À l'arrivée, un reflet traverse la vitre.
 */
function flyIntoPlace(bubble, originRect) {
  const DURATION = 620;
  const start = bubble.getBoundingClientRect();
  const ghostMessage = createElement("div", "message user-message message-ghost");
  const ghost = bubble.cloneNode(true);
  ghostMessage.append(ghost);
  ghostMessage.style.width = `${start.width}px`;
  document.body.append(ghostMessage);
  bubble.style.visibility = "hidden";

  const fromX = originRect.left + 18;
  const fromY = originRect.top + 4;
  const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
  const startTime = performance.now();

  function frame(now) {
    const progress = Math.min((now - startTime) / DURATION, 1);
    const eased = easeOutBack(progress);
    const target = bubble.getBoundingClientRect();
    const x = fromX + (target.left - fromX) * eased;
    const y = fromY + (target.top - fromY) * eased;
    const scale = 0.82 + 0.18 * eased;
    ghostMessage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    ghostMessage.style.opacity = String(Math.min(1, 0.25 + progress * 1.6));
    ghostMessage.style.filter = `blur(${(1 - progress) * 5}px)`;
    if (progress < 1) {
      requestAnimationFrame(frame);
      return;
    }
    ghostMessage.remove();
    bubble.style.visibility = "";
    bubble.classList.add("is-landing");
    bubble.addEventListener("animationend", () => bubble.classList.remove("is-landing"), { once: true });
  }
  requestAnimationFrame(frame);
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
