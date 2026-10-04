/**
 * Mode "Chat vocal" : conversation 100 % à la voix, en plein écran (comme un
 * appel). La messagerie est masquée, mais chaque phrase passe par le MÊME flux
 * que le chat écrit (askCopilot -> submitMessage de la page) : les échanges
 * sont enregistrés dans la conversation, visible à la fermeture.
 *
 * Boucle automatique, sans aucun bouton à toucher :
 *   LISTENING "Je vous écoute…" ─(silence après la phrase)─> THINKING "Le Copilote réfléchit…"
 *        ▲                                                          │
 *        └──────────── SPEAKING (réponse lue à voix haute) <────────┘
 *
 * La bulle centrale permet d'agir à tout moment : pendant l'écoute elle
 * envoie tout de suite, pendant la lecture elle interrompt le Copilote pour
 * reprendre la parole. Micro coupé ─> MUTED ; erreur ─> ERROR (+ actions).
 *
 * L'état courant est posé sur <dialog data-state="..."> : le CSS adapte les
 * animations (bulle, halos, bouche de l'avatar).
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
  HEARING: "hearing",
  PROCESSING: "processing",
  THINKING: "thinking",
  SPEAKING: "speaking",
  MUTED: "muted",
  ERROR: "error",
});

const STATUS_TEXT = {
  idle: "Touchez la bulle pour parler.",
  requesting: "Autorisation du micro…",
  listening: "Je vous écoute…",
  hearing: "Je vous écoute…",
  processing: "Envoi…",
  thinking: "Le Copilote réfléchit…",
  speaking: "Le Copilote vous répond",
  muted: "Micro coupé",
  error: "Le micro ne répond pas",
};

// Libellé (accessibilité) de la bulle centrale selon l'état.
const ORB_LABEL = {
  idle: "Parler",
  requesting: "Autorisation du micro en cours",
  listening: "Envoyer maintenant",
  hearing: "Envoyer maintenant",
  processing: "Envoi en cours",
  thinking: "Réponse en cours",
  speaking: "Interrompre le Copilote et parler",
  muted: "Réactiver le micro et parler",
  error: "Réessayer",
};

const BUSY_STATES = new Set([VOICE_STATES.REQUESTING, VOICE_STATES.PROCESSING, VOICE_STATES.THINKING]);

// Fin de phrase : le message part après ce silence.
const END_OF_SPEECH_SILENCE_MS = 1300;
// Écoutes terminées sans rien entendre d'affilée avant de se mettre en pause
// (évite de garder le micro ouvert indéfiniment si le technicien est parti).
const MAX_SILENT_ROUNDS = 6;

/**
 * @param {{
 *   dialog: HTMLDialogElement,
 *   askCopilot: (text: string) => Promise<string>,  envoie via le flux du chat ; rejette avec un message lisible
 *   getPreferences: () => object,
 *   getContextLabel?: () => string,                 ex. "GAB" : rappel de l'équipement en haut de l'écran
 * }} options
 */
export function createVoiceMode({ dialog, askCopilot, getPreferences, getContextLabel = () => "" }) {
  const query = (name) => dialog.querySelector(`[data-voice-${name}]`);
  const avatarSlot = query("avatar");
  const deviceLabel = query("device");
  const statusElement = query("status");
  const detailElement = query("detail");
  const transcriptElement = query("transcript");
  const replyElement = query("reply");
  const orbButton = query("main");
  const muteButton = query("mute");
  const muteIcon = muteButton.querySelector("[data-icon]");
  const muteLabel = muteButton.querySelector("[data-label]");
  const replayButton = query("replay");
  const endButton = query("end");
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
  let silentRounds = 0;
  // Incrémenté à chaque fermeture / nouveau tour : un résultat qui arrive
  // après coup (jeton périmé) est ignoré au lieu d'écraser l'écran.
  let turnToken = 0;

  function setState(nextState, { detail = "", errorCanInstallOffline = false } = {}) {
    state = nextState;
    dialog.dataset.state = nextState;
    const avatarState = nextState === "speaking" ? "speaking" : nextState === "hearing" ? "listening" : "idle";
    avatarSlot.firstElementChild?.setAttribute("data-state", avatarState);
    statusElement.textContent = STATUS_TEXT[nextState];
    detailElement.textContent = detail;
    detailElement.hidden = !detail;

    orbButton.setAttribute("aria-label", ORB_LABEL[nextState]);
    orbButton.disabled = BUSY_STATES.has(nextState);
    replayButton.disabled = !lastReply || nextState === VOICE_STATES.SPEAKING || BUSY_STATES.has(nextState);
    errorActions.hidden = nextState !== VOICE_STATES.ERROR;
    offlineButton.hidden = !errorCanInstallOffline;
  }

  function renderMuteButton() {
    muteButton.setAttribute("aria-pressed", String(muted));
    muteLabel.textContent = muted ? "Réactiver le micro" : "Couper le micro";
    setIcon(muteIcon, muted ? "mic-off" : "mic");
  }

  function cancelListening() {
    if (!listener) return;
    turnToken += 1;
    listener.cancel();
    listener = null;
  }

  /* ---------- Écoute ---------- */

  async function startListening() {
    if (!dialog.open) return;
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
      silenceMs: END_OF_SPEECH_SILENCE_MS,
      onStateChange: (listenState) => {
        if (token !== turnToken) return;
        if (listenState === LISTEN_STATES.REQUESTING_MICROPHONE) setState(VOICE_STATES.REQUESTING);
        if (listenState === LISTEN_STATES.LISTENING) setState(VOICE_STATES.LISTENING);
        if (listenState === LISTEN_STATES.PROCESSING) setState(VOICE_STATES.PROCESSING);
      },
      onSpeechStart: () => {
        if (token === turnToken && state === VOICE_STATES.LISTENING) setState(VOICE_STATES.HEARING);
      },
      onInterim: (text) => {
        if (token !== turnToken) return;
        transcriptElement.textContent = text;
        if (text && state === VOICE_STATES.LISTENING) setState(VOICE_STATES.HEARING);
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
      if (token === turnToken) listener = null;
      stopLevelMonitor();
    }

    if (token !== turnToken || !dialog.open) return;
    if (!transcript) {
      // Rien entendu : on se remet simplement à écouter, sans rien demander
      // au technicien -- sauf après plusieurs tours silencieux d'affilée.
      silentRounds += 1;
      if (silentRounds >= MAX_SILENT_ROUNDS) {
        setState(VOICE_STATES.IDLE, { detail: "Mise en pause après un long silence." });
        return;
      }
      void startListening();
      return;
    }
    silentRounds = 0;
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
    if (token !== turnToken || !dialog.open) return;
    lastReply = reply;
    replyElement.textContent = reply;
    await readReply(token);
  }

  /** Lit la dernière réponse puis, si le micro n'est pas coupé, réécoute automatiquement. */
  async function readReply(token) {
    if (lastReply && isSpeechSynthesisSupported()) {
      setState(VOICE_STATES.SPEAKING);
      await speak(lastReply, getPreferences());
      // Lecture interrompue (bulle touchée) ou mode fermé : le jeton a changé.
      if (token !== turnToken) return;
    }
    if (!dialog.open) return;
    if (muted) setState(VOICE_STATES.MUTED);
    else void startListening();
  }

  /* ---------- Contrôles ---------- */

  function handleOrb() {
    if (state === VOICE_STATES.LISTENING || state === VOICE_STATES.HEARING) {
      listener?.stop(); // la phrase entendue part tout de suite
    } else if (state === VOICE_STATES.SPEAKING) {
      // Interruption : on coupe la voix et on rend la parole au technicien.
      turnToken += 1;
      stopSpeaking();
      silentRounds = 0;
      void startListening();
    } else if (!BUSY_STATES.has(state)) {
      silentRounds = 0;
      fallbackForm.hidden = true;
      void startListening();
    }
  }

  function toggleMute() {
    muted = !muted;
    renderMuteButton();
    if (muted) {
      cancelListening();
      if (!BUSY_STATES.has(state) && state !== VOICE_STATES.SPEAKING) setState(VOICE_STATES.MUTED);
    } else if (state === VOICE_STATES.MUTED || state === VOICE_STATES.IDLE) {
      silentRounds = 0;
      void startListening();
    }
  }

  function close() {
    turnToken += 1;
    listener?.cancel();
    listener = null;
    stopSpeaking();
    fallbackForm.hidden = true;
    dialog.style.setProperty("--voice-level", "0");
    if (dialog.open) dialog.close();
  }

  orbButton.addEventListener("click", handleOrb);
  muteButton.addEventListener("click", toggleMute);
  replayButton.addEventListener("click", () => {
    cancelListening();
    void readReply(++turnToken);
  });
  endButton.addEventListener("click", close);
  closeButton.addEventListener("click", close);
  retryButton.addEventListener("click", () => {
    silentRounds = 0;
    void startListening();
  });
  offlineButton.addEventListener("click", async () => {
    offlineButton.disabled = true;
    const installed = await installOnDeviceRecognition();
    offlineButton.disabled = false;
    if (installed) void startListening();
    else detailElement.textContent = "La reconnaissance hors ligne n’a pas pu être installée dans ce navigateur.";
  });
  typeInsteadButton.addEventListener("click", () => {
    cancelListening();
    fallbackForm.hidden = false;
    fallbackInput.focus();
  });
  fallbackForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = fallbackInput.value.trim();
    if (!text || BUSY_STATES.has(state)) return;
    fallbackInput.value = "";
    fallbackForm.hidden = true;
    transcriptElement.textContent = text;
    void respond(text, ++turnToken);
  });
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
      deviceLabel.textContent = getContextLabel();
      lastReply = "";
      silentRounds = 0;
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
    get isOpen() {
      return dialog.open;
    },
  };
}
