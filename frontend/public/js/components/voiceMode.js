/**
 * Mode "Chat vocal" : surcouche immersive AU-DESSUS de la conversation.
 *
 * Il n'a pas de fil de discussion à lui : chaque phrase reconnue est envoyée
 * par le MÊME flux que le chat écrit (askCopilot -> submitMessage de la page),
 * donc les échanges s'affichent dans la conversation visible derrière le voile.
 *
 *   micro ─> LISTENING "Je vous écoute…" ─> PROCESSING "Traitement…"
 *        ─> THINKING "Réponse en cours…" ─> SPEAKING (lecture) ─> réécoute (mains libres)
 *   Toute erreur ─> ERROR (message + actions) ; micro coupé ─> MUTED
 *
 * L'état courant est posé sur <dialog data-state="..."> : le CSS adapte les
 * animations (anneaux, ondes, bouche de l'avatar).
 */

import { startAudioLevelMonitor } from "../services/speech/audioLevelMonitor.js";
import {
  LISTEN_STATES,
  installOnDeviceRecognition,
  isSpeechRecognitionSupported,
  listen,
} from "../services/speech/speechRecognitionService.js";
import { isSpeechSynthesisSupported, speak, stopSpeaking } from "../services/speech/speechSynthesisService.js";
import { renderAvatar } from "./avatar.js";
import { setIcon } from "./icons.js";

export const VOICE_STATES = Object.freeze({
  IDLE: "idle",
  REQUESTING: "requesting",
  LISTENING: "listening",
  PROCESSING: "processing",
  THINKING: "thinking",
  SPEAKING: "speaking",
  MUTED: "muted",
  ERROR: "error",
});

const STATUS_TEXT = {
  idle: "Appuyez sur le micro pour parler.",
  requesting: "Autorisation du micro…",
  listening: "Je vous écoute…",
  processing: "Traitement…",
  thinking: "Réponse en cours…",
  speaking: "Le Copilote vous répond…",
  muted: "Micro coupé.",
  error: "Erreur microphone",
};

// Icône et libellé du gros bouton central selon l'état.
const MAIN_BUTTON = {
  idle: { icon: "mic", label: "Parler" },
  requesting: { icon: "mic", label: "Autorisation du micro en cours" },
  listening: { icon: "stop", label: "J’ai terminé ma phrase" },
  processing: { icon: "mic", label: "Traitement en cours" },
  thinking: { icon: "mic", label: "Réponse en cours" },
  speaking: { icon: "stop", label: "Arrêter la lecture" },
  muted: { icon: "mic-off", label: "Réactiver le micro et parler" },
  error: { icon: "refresh", label: "Réessayer" },
};

const BUSY_STATES = new Set([VOICE_STATES.REQUESTING, VOICE_STATES.PROCESSING, VOICE_STATES.THINKING]);

/**
 * @param {{
 *   dialog: HTMLDialogElement,
 *   askCopilot: (text: string) => Promise<string>,  envoie via le flux du chat ; rejette avec un message lisible
 *   getPreferences: () => object,
 * }} options
 */
export function createVoiceMode({ dialog, askCopilot, getPreferences }) {
  const query = (name) => dialog.querySelector(`[data-voice-${name}]`);
  const avatarSlot = query("avatar");
  const statusElement = query("status");
  const detailElement = query("detail");
  const transcriptElement = query("transcript");
  const replyElement = query("reply");
  const mainButton = query("main");
  const mainIcon = mainButton.querySelector("[data-icon]");
  const muteButton = query("mute");
  const muteIcon = muteButton.querySelector("[data-icon]");
  const muteLabel = muteButton.querySelector("[data-label]");
  const stopReadingButton = query("stop-reading");
  const replayButton = query("replay");
  const closeButton = query("close");
  const errorActions = query("error-actions");
  const retryButton = query("retry");
  const offlineButton = query("offline");
  const typeInsteadButton = query("type-instead");
  const fallbackForm = query("fallback");
  const fallbackInput = fallbackForm.querySelector("input");

  let state = VOICE_STATES.IDLE;
  let muted = false;
  let listener = null;
  let lastReply = "";
  // Incrémenté à chaque fermeture / nouveau tour : un résultat qui arrive
  // après coup (jeton périmé) est ignoré au lieu d'écraser l'écran.
  let turnToken = 0;

  function setState(nextState, { detail = "", errorCanInstallOffline = false } = {}) {
    state = nextState;
    dialog.dataset.state = nextState;
    avatarSlot.firstElementChild?.setAttribute("data-state", nextState === "speaking" ? "speaking" : nextState === "listening" ? "listening" : "idle");
    statusElement.textContent = STATUS_TEXT[nextState];
    detailElement.textContent = detail;
    detailElement.hidden = !detail;

    setIcon(mainIcon, MAIN_BUTTON[nextState].icon);
    mainButton.setAttribute("aria-label", MAIN_BUTTON[nextState].label);
    mainButton.disabled = BUSY_STATES.has(nextState);

    stopReadingButton.hidden = nextState !== VOICE_STATES.SPEAKING;
    replayButton.hidden = !lastReply || nextState === VOICE_STATES.SPEAKING || !isSpeechSynthesisSupported();
    errorActions.hidden = nextState !== VOICE_STATES.ERROR;
    offlineButton.hidden = !errorCanInstallOffline;
  }

  function renderMuteButton() {
    muteButton.setAttribute("aria-pressed", String(muted));
    muteLabel.textContent = muted ? "Réactiver le micro" : "Couper le micro";
    setIcon(muteIcon, muted ? "mic-off" : "mic");
  }

  /* ---------- Écoute ---------- */

  async function startListening() {
    if (!isSpeechRecognitionSupported()) {
      setState(VOICE_STATES.ERROR, {
        detail: "La reconnaissance vocale n’est pas disponible dans ce navigateur. Utilisez Chrome ou Edge, ou écrivez votre question ci-dessous.",
      });
      fallbackForm.hidden = false;
      return;
    }

    stopSpeaking();
    muted = false;
    renderMuteButton();
    const token = ++turnToken;
    transcriptElement.textContent = "";
    let stopLevelMonitor = () => {};

    listener = listen({
      onStateChange: (listenState) => {
        if (token !== turnToken) return;
        if (listenState === LISTEN_STATES.REQUESTING_MICROPHONE) setState(VOICE_STATES.REQUESTING);
        if (listenState === LISTEN_STATES.LISTENING) setState(VOICE_STATES.LISTENING);
        if (listenState === LISTEN_STATES.PROCESSING) setState(VOICE_STATES.PROCESSING);
      },
      onInterim: (text) => {
        if (token === turnToken) transcriptElement.textContent = text;
      },
      onMicrophoneStream: (stream) => {
        stopLevelMonitor = startAudioLevelMonitor(stream, (level) => dialog.style.setProperty("--voice-level", level.toFixed(3)));
      },
    });

    let transcript;
    try {
      transcript = await listener.promise;
    } catch (error) {
      if (token === turnToken) {
        setState(VOICE_STATES.ERROR, { detail: error.message, errorCanInstallOffline: error.canInstallOffline });
      }
      return;
    } finally {
      listener = null;
      stopLevelMonitor();
    }

    if (token !== turnToken) return;
    if (!transcript) {
      setState(muted ? VOICE_STATES.MUTED : VOICE_STATES.IDLE, {
        detail: muted ? "" : "Je n’ai rien entendu. Appuyez sur le micro et parlez près de celui-ci.",
      });
      return;
    }
    transcriptElement.textContent = transcript;
    await respond(transcript, token);
  }

  /* ---------- Réponse : même flux que le chat écrit ---------- */

  async function respond(text, token) {
    setState(VOICE_STATES.THINKING);
    replyElement.textContent = "";
    let reply;
    try {
      reply = await askCopilot(text);
    } catch (error) {
      if (token === turnToken) setState(VOICE_STATES.ERROR, { detail: error.message });
      return;
    }
    if (token !== turnToken) return;
    lastReply = reply;
    replyElement.textContent = reply;
    await readReply(token, { thenListen: true });
  }

  async function readReply(token, { thenListen }) {
    if (!lastReply || !isSpeechSynthesisSupported()) {
      setState(VOICE_STATES.IDLE);
      return;
    }
    setState(VOICE_STATES.SPEAKING);
    await speak(lastReply, getPreferences());
    // Lecture arrêtée par le technicien (stopReading) ou mode fermé : le jeton a changé.
    if (token !== turnToken) return;

    // Mains libres : on réécoute automatiquement, sauf si le micro est coupé.
    if (thenListen && !muted && getPreferences().handsFree && dialog.open) {
      void startListening();
    } else {
      setState(muted ? VOICE_STATES.MUTED : VOICE_STATES.IDLE);
    }
  }

  /* ---------- Contrôles ---------- */

  function stopReading() {
    turnToken += 1;
    stopSpeaking();
    setState(muted ? VOICE_STATES.MUTED : VOICE_STATES.IDLE);
  }

  function handleMainButton() {
    if (state === VOICE_STATES.LISTENING) listener?.stop(); // la phrase entendue est envoyée
    else if (state === VOICE_STATES.SPEAKING) stopReading();
    else if (!BUSY_STATES.has(state)) void startListening();
  }

  function toggleMute() {
    muted = !muted;
    renderMuteButton();
    if (muted) {
      if (listener) {
        turnToken += 1;
        listener.cancel();
        listener = null;
      }
      if (!BUSY_STATES.has(state) && state !== VOICE_STATES.SPEAKING) setState(VOICE_STATES.MUTED);
    } else if (state === VOICE_STATES.MUTED) {
      void startListening();
    }
  }

  function close() {
    turnToken += 1;
    listener?.cancel();
    listener = null;
    stopSpeaking();
    fallbackForm.hidden = true;
    if (dialog.open) dialog.close();
  }

  mainButton.addEventListener("click", handleMainButton);
  muteButton.addEventListener("click", toggleMute);
  stopReadingButton.addEventListener("click", stopReading);
  replayButton.addEventListener("click", () => {
    turnToken += 1;
    void readReply(turnToken, { thenListen: false });
  });
  retryButton.addEventListener("click", () => void startListening());
  offlineButton.addEventListener("click", async () => {
    offlineButton.disabled = true;
    const installed = await installOnDeviceRecognition();
    offlineButton.disabled = false;
    if (installed) void startListening();
    else detailElement.textContent = "La reconnaissance hors ligne n’a pas pu être installée dans ce navigateur.";
  });
  typeInsteadButton.addEventListener("click", () => {
    fallbackForm.hidden = false;
    fallbackInput.focus();
  });
  fallbackForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = fallbackInput.value.trim();
    if (!text || BUSY_STATES.has(state)) return;
    fallbackInput.value = "";
    transcriptElement.textContent = text;
    void respond(text, ++turnToken);
  });
  closeButton.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault(); // Échap : on passe par close() pour tout arrêter proprement
    close();
  });
  // Chrome ne déclenche pas toujours "cancel" (sans interaction récente) : on écoute aussi la touche.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });

  return {
    /** Ouvre le mode vocal et commence immédiatement à écouter. */
    open() {
      avatarSlot.replaceChildren(renderAvatar(getPreferences().avatar, "avatar-large"));
      lastReply = "";
      transcriptElement.textContent = "";
      replyElement.textContent = "";
      fallbackForm.hidden = true;
      muted = false;
      renderMuteButton();
      setState(VOICE_STATES.IDLE);
      dialog.showModal();
      void startListening();
    },
    close,
  };
}
