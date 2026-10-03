/**
 * Speech-to-Text dans le navigateur (Web Speech API). Aucun appel backend :
 * seul le TEXTE reconnu est ensuite envoyé au Copilote.
 *
 * Déroulé d'une écoute (listen) :
 *   1. accès au micro (getUserMedia)  -> erreurs "micro refusé / absent / occupé" précises
 *   2. reconnaissance SUR L'APPAREIL si Chrome la propose (aucune connexion requise)
 *      sinon service en ligne du navigateur (Chrome envoie l'audio à Google)
 *   3. états : listening (micro ouvert) -> processing (fin de phrase, transcription)
 *
 * L'erreur "network" ne signifie PAS que l'ordinateur est hors ligne : c'est le
 * service de transcription du navigateur qui est injoignable (navigateur sans
 * ce service, pare-feu, proxy...). On l'explique tel quel à l'utilisateur.
 */

import { SPEECH_LANG } from "../../config.js";

const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

export const LISTEN_STATES = Object.freeze({
  REQUESTING_MICROPHONE: "requesting-microphone",
  LISTENING: "listening",
  PROCESSING: "processing",
});

/** Erreur de reconnaissance : `code` permet à l'interface d'adapter le message et les actions. */
export class SpeechRecognitionError extends Error {
  constructor(code, message, { canInstallOffline = false } = {}) {
    super(message);
    this.name = "SpeechRecognitionError";
    this.code = code;
    this.canInstallOffline = canInstallOffline;
  }
}

const ERROR_MESSAGES = {
  "unsupported": "La reconnaissance vocale n’est pas disponible dans ce navigateur. Utilisez Google Chrome ou Microsoft Edge.",
  "insecure-context": "Le micro n’est utilisable que sur une adresse sécurisée (https ou http://127.0.0.1).",
  "microphone-denied": "Accès au microphone refusé. Cliquez sur l’icône 🔒 dans la barre d’adresse puis autorisez le micro.",
  "microphone-missing": "Aucun microphone détecté. Branchez un micro ou un casque puis réessayez.",
  "microphone-busy": "Le microphone est déjà utilisé par une autre application. Fermez-la puis réessayez.",
  "network":
    "Le service de transcription du navigateur est injoignable. Votre connexion n’est pas en cause : ce navigateur ne fournit pas ce service ou il est bloqué (pare-feu, proxy). Ouvrez la page dans Google Chrome ou Microsoft Edge, ou dictez avec Windows (touches ⊞ + H).",
  "language-not-supported": "Le français n’est pas pris en charge par la reconnaissance vocale de ce navigateur.",
  "service-not-allowed": "Le navigateur a bloqué son service de reconnaissance vocale. Vérifiez les autorisations du site.",
  "unknown": "La reconnaissance vocale a échoué. Réessayez.",
};

function createError(code, options) {
  return new SpeechRecognitionError(code, ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown, options);
}

export function isSpeechRecognitionSupported() {
  return Boolean(SpeechRecognitionClass);
}

/* ---------- Reconnaissance sur l'appareil (Chrome 139+) ---------- */

const onDeviceOptions = () => ({ langs: [SPEECH_LANG], processLocally: true });

/**
 * @returns {Promise<"available"|"downloadable"|"downloading"|"unavailable"|"unsupported">}
 */
export async function getOnDeviceRecognitionStatus() {
  if (typeof SpeechRecognitionClass?.available !== "function") return "unsupported";
  try {
    const status = await SpeechRecognitionClass.available(onDeviceOptions());
    if (status === true) return "available"; // premières versions : booléen
    if (status === false) return "unavailable";
    return status;
  } catch {
    return "unsupported";
  }
}

/** Télécharge le modèle français hors ligne. Doit être appelé depuis un clic. */
export async function installOnDeviceRecognition() {
  if (typeof SpeechRecognitionClass?.install !== "function") return false;
  try {
    return Boolean(await SpeechRecognitionClass.install(onDeviceOptions()));
  } catch {
    return false;
  }
}

/* ---------- Micro ---------- */

/**
 * Ouvre le micro pour vérifier l'autorisation AVANT de lancer la reconnaissance,
 * ce qui donne des messages d'erreur précis.
 * @returns {Promise<MediaStream|null>} null si getUserMedia est indisponible
 */
export async function openMicrophone() {
  if (!window.isSecureContext) throw createError("insecure-context");
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") throw createError("microphone-denied");
    if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") throw createError("microphone-missing");
    if (error?.name === "NotReadableError" || error?.name === "AbortError") throw createError("microphone-busy");
    throw createError("unknown");
  }
}

export function closeMicrophone(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/* ---------- Une session de reconnaissance ---------- */

function runRecognition({ processLocally, onInterim, onStateChange }) {
  const recognition = new SpeechRecognitionClass();
  recognition.lang = SPEECH_LANG;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  if (processLocally) recognition.processLocally = true;

  let finalText = "";
  let errorCode = null;

  const promise = new Promise((resolve, reject) => {
    recognition.onaudiostart = () => onStateChange(LISTEN_STATES.LISTENING);
    recognition.onspeechend = () => onStateChange(LISTEN_STATES.PROCESSING);
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onInterim(`${finalText} ${interim}`.trim());
    };
    // "aborted" = arrêt volontaire ; "no-speech" = silence : ce ne sont pas des pannes.
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") errorCode = event.error;
    };
    recognition.onend = () => (errorCode ? reject(errorCode) : resolve(finalText.trim()));
  });

  try {
    recognition.start();
  } catch {
    return { promise: Promise.reject("unknown"), stop() {}, abort() {} };
  }
  return { promise, stop: () => recognition.stop(), abort: () => recognition.abort() };
}

/**
 * Écoute UNE phrase puis s'arrête.
 *
 * @param {{
 *   onInterim?: (text: string) => void,              texte partiel affiché en direct
 *   onStateChange?: (state: string) => void,          voir LISTEN_STATES
 *   onMicrophoneStream?: (stream: MediaStream) => void  ex. animation du volume
 * }} handlers
 * @returns {{ promise: Promise<string>, stop: () => void, cancel: () => void }}
 *          promise = texte reconnu ("" si rien entendu) ; rejet = SpeechRecognitionError
 *          stop = fin d'écoute, la phrase entendue est conservée ; cancel = tout abandonner
 */
export function listen({ onInterim = () => {}, onStateChange = () => {}, onMicrophoneStream = () => {} } = {}) {
  let activeSession = null;
  let cancelled = false;
  let stopRequested = false;

  async function run() {
    if (!isSpeechRecognitionSupported()) throw createError("unsupported");

    onStateChange(LISTEN_STATES.REQUESTING_MICROPHONE);
    const stream = await openMicrophone();
    if (cancelled || stopRequested) {
      closeMicrophone(stream);
      return "";
    }
    if (stream) onMicrophoneStream(stream);

    try {
      const onDeviceStatus = await getOnDeviceRecognitionStatus();
      let processLocally = onDeviceStatus === "available";
      // Le service en ligne échoue parfois une première fois : un essai de plus,
      // puis passage à la reconnaissance locale si elle vient d'être installée.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        activeSession = runRecognition({ processLocally, onInterim, onStateChange });
        try {
          return await activeSession.promise;
        } catch (code) {
          if (cancelled) return "";
          const canRetry = attempt === 1 && (code === "network" || code === "language-not-supported");
          if (!canRetry) throw toRecognitionError(code, onDeviceStatus);
          processLocally = code === "language-not-supported" ? false : (await getOnDeviceRecognitionStatus()) === "available";
        }
      }
      return "";
    } finally {
      closeMicrophone(stream);
    }
  }

  function toRecognitionError(code, onDeviceStatus) {
    if (code === "not-allowed") return createError("microphone-denied");
    if (code === "audio-capture") return createError("microphone-missing");
    if (code === "network") {
      return createError("network", { canInstallOffline: onDeviceStatus === "downloadable" });
    }
    return createError(ERROR_MESSAGES[code] ? code : "unknown");
  }

  return {
    promise: run(),
    stop() {
      stopRequested = true;
      activeSession?.stop();
    },
    cancel() {
      cancelled = true;
      activeSession?.abort();
    },
  };
}
