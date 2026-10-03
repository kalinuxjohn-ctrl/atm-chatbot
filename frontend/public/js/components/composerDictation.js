/**
 * Dictée dans la zone de saisie (gros bouton micro du chat écrit).
 *
 *   clic ─> autorisation micro ─> "Écoute en cours…" ─> "Traitement…"
 *       ─> le texte reconnu est ajouté dans la zone de saisie (non envoyé :
 *          le technicien relit puis envoie) ; toute erreur ─> "Erreur microphone"
 *
 * Un second clic pendant l'écoute termine la phrase.
 */

import {
  LISTEN_STATES,
  installOnDeviceRecognition,
  isSpeechRecognitionSupported,
  listen,
} from "../services/speech/speechRecognitionService.js";
import { createElement } from "../utils/dom.js";
import { setIcon } from "./icons.js";

const STATUS = {
  [LISTEN_STATES.REQUESTING_MICROPHONE]: "Autorisation du micro…",
  [LISTEN_STATES.LISTENING]: "Écoute en cours… parlez maintenant",
  [LISTEN_STATES.PROCESSING]: "Traitement…",
};

/**
 * @param {{ button: HTMLButtonElement, statusElement: HTMLElement, input: HTMLTextAreaElement,
 *           onTextChange: () => void, beforeStart?: () => void }} options
 */
export function createComposerDictation({ button, statusElement, input, onTextChange, beforeStart = () => {} }) {
  const buttonIcon = button.querySelector("[data-icon]");
  let session = null;

  function showStatus(state, text, { action = null } = {}) {
    statusElement.dataset.state = state;
    statusElement.hidden = state === "idle";
    statusElement.setAttribute("role", state === "error" ? "alert" : "status");
    const children = [createElement("span", "dictation-status-dot"), createElement("span", "dictation-status-text", text)];
    if (action) children.push(action);
    statusElement.replaceChildren(...children);
  }

  function setButtonListening(isListening) {
    button.classList.toggle("is-listening", isListening);
    button.setAttribute("aria-pressed", String(isListening));
    button.setAttribute("aria-label", isListening ? "Terminer la dictée" : "Dicter votre message au micro");
    setIcon(buttonIcon, isListening ? "stop" : "mic");
  }

  function createOfflineAction() {
    const action = createElement("button", "dictation-status-action", "Activer la reconnaissance hors ligne");
    action.type = "button";
    action.addEventListener("click", async () => {
      action.disabled = true;
      action.textContent = "Téléchargement…";
      const installed = await installOnDeviceRecognition();
      if (installed) {
        showStatus("idle", "");
        void start();
      } else {
        action.textContent = "Indisponible dans ce navigateur";
      }
    });
    return action;
  }

  async function start() {
    if (!isSpeechRecognitionSupported()) {
      showStatus("error", "Erreur microphone : la dictée n’est pas disponible dans ce navigateur (utilisez Chrome ou Edge, ou ⊞ + H sous Windows).");
      return;
    }
    beforeStart();
    const baseText = input.value.trim();
    const withBase = (text) => [baseText, text].filter(Boolean).join(" ");

    setButtonListening(true);
    session = listen({
      onStateChange: (state) => showStatus(state, STATUS[state]),
      onInterim: (text) => {
        input.value = withBase(text);
        onTextChange();
      },
    });

    try {
      const transcript = await session.promise;
      if (session.cancelled) {
        input.value = baseText;
        onTextChange();
        showStatus("idle", "");
        return;
      }
      input.value = withBase(transcript);
      onTextChange();
      if (transcript) {
        showStatus("idle", "");
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      } else {
        showStatus("info", "Je n’ai rien entendu. Appuyez sur le micro et parlez près de celui-ci.");
      }
    } catch (error) {
      input.value = baseText;
      onTextChange();
      showStatus("error", `Erreur microphone : ${error.message}`, {
        action: error.canInstallOffline ? createOfflineAction() : null,
      });
    } finally {
      session = null;
      setButtonListening(false);
    }
  }

  button.addEventListener("click", () => {
    if (session) session.stop();
    else void start();
  });

  return {
    /** Arrête la dictée en cours sans garder le texte partiel. */
    cancel() {
      if (!session) return;
      session.cancelled = true;
      session.cancel();
    },
    get isActive() {
      return Boolean(session);
    },
  };
}
