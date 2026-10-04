/**
 * Text-to-Speech du Copilote : TOUJOURS une voix française.
 *
 * Deux moteurs :
 *   1. "server"  : voix neuronales françaises générées par server.py (/tts,
 *                  edge-tts). Homme ET femme, identiques dans tous les
 *                  navigateurs -- c'est le moteur utilisé par défaut.
 *   2. "browser" : speechSynthesis du navigateur, en repli si le serveur ne
 *                  répond pas. On n'y utilise QUE des voix françaises : une
 *                  voix anglaise lirait le français avec un accent américain.
 *
 * Ordre de choix de la voix :
 *   1. la voix précise choisie dans les paramètres (voiceURI)
 *   2. une voix serveur du genre choisi (Denise / Henri par défaut)
 *   3. une voix française du navigateur du genre choisi
 *   4. une voix française du navigateur quelconque (hauteur ajustée)
 *   5. aucune voix française : langue fr-FR imposée, voix choisie par le navigateur
 */

import { SPEECH_LANG } from "../../config.js";

const synth = window.speechSynthesis;

const FRENCH_PREFIX = "fr";
const PREFERRED_LANG = SPEECH_LANG.toLowerCase(); // "fr-fr"
const SERVER_PREFIX = "server:";
const SERVER_VOICES_URL = "/tts/voices";
const SERVER_TTS_URL = "/tts";
const SERVER_TIMEOUT_MS = 20000;
// Après un échec du serveur, on reste sur le navigateur un moment avant de réessayer.
const SERVER_RETRY_DELAY_MS = 60000;

// Prénoms des voix françaises courantes (Windows, Edge, Chrome, macOS, Android), sans accents.
const FEMALE_NAMES = [
  "female", "femme", "woman", "denise", "eloise", "vivienne", "hortense", "julie", "amelie", "audrey",
  "aurelie", "marie", "virginie", "celine", "elise", "coralie", "jacqueline", "brigitte", "yvette",
  "lea", "sylvie", "chantal", "caroline", "ariane", "charline", "josephine", "celeste", "manon",
  "sophie", "claire", "camille", "lucie", "sabine", "isabelle", "juliette", "chloe", "emma", "louise",
];
const MALE_NAMES = [
  "male", "homme", "man", "henri", "remy", "paul", "thomas", "claude", "nicolas", "antoine", "jerome",
  "alain", "guillaume", "jean", "louis", "mathieu", "fabrice", "yves", "maurice", "gerard", "daniel",
  "lucien", "christophe", "frederic", "olivier", "pierre", "jacques", "theo", "hugo", "arnaud", "thierry",
];
// "Google français" est une voix féminine.
const KNOWN_FEMALE_VOICES = ["google francais"];

// Si la voix française disponible n'a pas le genre demandé, on rapproche sa hauteur.
const FALLBACK_PITCH = { female: 1.18, male: 0.82 };

// Lecture morceau par morceau : le premier morceau est court pour que la voix
// démarre vite, les suivants sont préparés pendant la lecture du précédent.
const FIRST_CHUNK_LENGTH = 160;
const MAX_CHUNK_LENGTH = 380;
const MAX_BROWSER_CHUNK_LENGTH = 220; // Chrome coupe les lectures longues (~15 s)

export const GENDER_LABELS = Object.freeze({ female: "Féminine", male: "Masculine", unknown: "Genre non précisé" });

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["fr"], { type: "region" }) : null;

let speakToken = 0;
let speaking = false;
let currentAudio = null;
let serverVoicesPromise = null;
let serverUnavailableUntil = 0;

export function isSpeechSynthesisSupported() {
  return typeof Audio !== "undefined" || Boolean(synth);
}

export function isSpeaking() {
  return speaking;
}

const normalize = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const isFrench = (voice) => voice.lang.toLowerCase().replace("_", "-").startsWith(FRENCH_PREFIX);
const isPreferredLang = (lang) => lang.toLowerCase().replace("_", "-") === PREFERRED_LANG;

/** @returns {"female"|"male"|"unknown"} */
export function classifyVoice(voice) {
  const name = normalize(voice.name);
  if (KNOWN_FEMALE_VOICES.some((known) => name.includes(known))) return "female";
  const words = name.split(/[^a-z]+/);
  // "female" contient "male" : on compare des MOTS entiers, féminin d'abord.
  if (FEMALE_NAMES.some((hint) => words.includes(hint))) return "female";
  if (MALE_NAMES.some((hint) => words.includes(hint))) return "male";
  return "unknown";
}

/** "Microsoft Denise Online (Natural) - French (France)" -> "Denise". */
function extractShortName(voice) {
  if (normalize(voice.name).includes("google francais")) return "Google français";
  const cleaned = voice.name
    .replace(/\(.*?\)/g, " ")
    .replace(/\s-\s.*$/, " ")
    .replace(/\b(Microsoft|Google|Apple|Online|Desktop|Natural|Neural|Multilingual|Enhanced|Premium|Compact)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || voice.name;
}

/** "fr-FR" -> "Français (France)". */
export function describeLanguage(lang) {
  const [, region] = lang.replace("_", "-").split("-");
  if (!region) return "Français";
  let regionName = region.toUpperCase();
  try {
    regionName = regionNames?.of(region.toUpperCase()) || regionName;
  } catch {
    /* code région inconnu : on garde le code */
  }
  return `Français (${regionName})`;
}

/**
 * Décrit une voix du NAVIGATEUR pour l'affichage.
 * @returns {{ engine: "browser", voice: SpeechSynthesisVoice, voiceURI: string, shortName: string, gender: string,
 *             genderLabel: string, languageLabel: string, group: string, isNatural: boolean }}
 */
export function describeVoice(voice) {
  const gender = classifyVoice(voice);
  const languageLabel = isFrench(voice) ? describeLanguage(voice.lang) : voice.lang;
  return {
    engine: "browser",
    voice,
    lang: voice.lang,
    voiceURI: voice.voiceURI,
    shortName: extractShortName(voice),
    gender,
    genderLabel: GENDER_LABELS[gender],
    languageLabel,
    group: `Voix du navigateur · ${languageLabel}`,
    isNatural: /natural|neural|online|enhanced|premium/i.test(voice.name) || voice.localService === false,
  };
}

/** Décrit une voix SERVEUR ({ id, name, gender, locale } renvoyé par /tts/voices). */
function describeServerVoice({ id, name, gender, locale }) {
  const languageLabel = describeLanguage(locale);
  return {
    engine: "server",
    voice: null,
    serverVoiceId: id,
    lang: locale,
    voiceURI: `${SERVER_PREFIX}${id}`,
    shortName: name,
    gender: gender === "male" ? "male" : "female",
    genderLabel: GENDER_LABELS[gender === "male" ? "male" : "female"],
    languageLabel,
    group: `Voix naturelles · ${languageLabel}`,
    isNatural: true,
  };
}

/* ---------- Chargement des voix ---------- */

function loadBrowserVoices() {
  if (!synth) return Promise.resolve([]);
  const voices = synth.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);

  // Chrome charge les voix de façon asynchrone.
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500); // certains navigateurs n'émettent jamais l'événement
  });
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Voix serveur (une seule requête par page) ; [] si le serveur ne propose pas la synthèse. */
function loadServerVoices() {
  if (!serverVoicesPromise) {
    serverVoicesPromise = fetchWithTimeout(SERVER_VOICES_URL)
      .then((response) => (response.ok ? response.json() : { voices: [] }))
      .then((payload) => (Array.isArray(payload?.voices) ? payload.voices.map(describeServerVoice) : []))
      .catch(() => []);
  }
  return serverVoicesPromise;
}

function isServerUsable() {
  return Date.now() >= serverUnavailableUntil;
}

/**
 * Voix françaises disponibles : voix serveur (naturelles) d'abord, puis voix
 * du navigateur (fr-FR d'abord, puis naturelles, puis ordre alphabétique).
 */
export async function listFrenchVoices() {
  const [serverVoices, browserVoices] = await Promise.all([loadServerVoices(), loadBrowserVoices()]);
  const browserFrench = browserVoices
    .filter(isFrench)
    .map(describeVoice)
    .sort(
      (a, b) =>
        Number(isPreferredLang(b.lang)) - Number(isPreferredLang(a.lang)) ||
        a.languageLabel.localeCompare(b.languageLabel, "fr") ||
        Number(b.isNatural) - Number(a.isNatural) ||
        a.shortName.localeCompare(b.shortName, "fr"),
    );
  return [...serverVoices, ...browserFrench];
}

/**
 * Voix réellement utilisée pour des préférences données.
 * @param {{ voiceURI: string|null, voiceGender: "female"|"male" }} preferences
 * @param {{ allowServer?: boolean }} options
 * @returns {Promise<{ description: object|null, pitch: number, genderMatched: boolean }>}
 */
export async function resolveVoice({ voiceURI, voiceGender }, { allowServer = isServerUsable() } = {}) {
  const voices = (await listFrenchVoices()).filter((voice) => allowServer || voice.engine !== "server");

  const exact = voiceURI && voices.find((voice) => voice.voiceURI === voiceURI);
  if (exact) return { description: exact, pitch: 1, genderMatched: true };

  const matching = voices.find((voice) => voice.gender === voiceGender);
  if (matching) return { description: matching, pitch: 1, genderMatched: true };

  const fallback = voices.find((voice) => voice.gender === "unknown") || voices[0] || null;
  return { description: fallback, pitch: FALLBACK_PITCH[voiceGender] ?? 1, genderMatched: false };
}

/* ---------- Découpage du texte ---------- */

/** Découpe le texte en morceaux sur les fins de phrase ; le premier reste court. */
function splitIntoChunks(text, maxLength) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?;:\n]+[.!?;:]*|\S+/g) || [];
  const chunks = [];
  let current = "";
  sentences.forEach((sentence) => {
    const limit = chunks.length === 0 ? Math.min(FIRST_CHUNK_LENGTH, maxLength) : maxLength;
    const candidate = `${current} ${sentence}`.trim();
    if (candidate.length > limit && current) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = candidate;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

/* ---------- Moteur serveur ---------- */

async function fetchServerAudio(text, voiceId) {
  const response = await fetchWithTimeout(SERVER_TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voiceId }),
  });
  if (!response.ok) throw new Error(`TTS ${response.status}`);
  return URL.createObjectURL(await response.blob());
}

function playAudioUrl(url, token) {
  return new Promise((resolve, reject) => {
    if (token !== speakToken) {
      resolve();
      return;
    }
    const audio = new Audio(url);
    currentAudio = audio;
    const finish = () => {
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onended = finish;
    audio.onpause = finish; // stopSpeaking() met l'audio en pause
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null;
      reject(new Error("Lecture audio impossible"));
    };
    audio.play().catch(reject);
  });
}

/**
 * Lit les morceaux avec la voix serveur ; le morceau suivant est généré
 * pendant la lecture du précédent. En cas d'échec, renvoie l'index du premier
 * morceau NON lu (pour finir avec le navigateur) et si la faute vient du
 * serveur ; sinon null.
 * @returns {Promise<{ failedAt: number, serverFailed: boolean } | null>}
 */
async function speakWithServer(chunks, voiceId, token) {
  const urls = [];
  const audioFor = (index) => {
    if (!urls[index]) urls[index] = fetchServerAudio(chunks[index], voiceId);
    return urls[index];
  };
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      if (token !== speakToken) return null;
      let url;
      try {
        url = await audioFor(index);
      } catch {
        return { failedAt: index, serverFailed: true };
      }
      if (index + 1 < chunks.length) void audioFor(index + 1).catch(() => {});
      try {
        await playAudioUrl(url, token);
      } catch {
        return { failedAt: index, serverFailed: false }; // lecture bloquée par le navigateur
      }
    }
    return null;
  } finally {
    urls.forEach((pending) => pending?.then((url) => URL.revokeObjectURL(url)).catch(() => {}));
  }
}

/* ---------- Moteur navigateur ---------- */

function speakBrowserChunk(text, voice, pitch) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    // Langue française TOUJOURS imposée, même sans voix française trouvée.
    utterance.lang = voice && isFrench(voice) ? voice.lang : SPEECH_LANG;
    if (voice && isFrench(voice)) utterance.voice = voice;
    utterance.pitch = pitch;
    utterance.rate = 1;
    utterance.onend = resolve;
    utterance.onerror = resolve; // "interrupted" lors d'un arrêt volontaire : rien à signaler
    synth.speak(utterance);
  });
}

async function speakWithBrowser(text, preferences, token) {
  if (!synth) return;
  const { description, pitch } = await resolveVoice(preferences, { allowServer: false });
  for (const chunk of splitIntoChunks(text, MAX_BROWSER_CHUNK_LENGTH)) {
    if (token !== speakToken) break;
    await speakBrowserChunk(chunk, description?.voice ?? null, pitch);
  }
}

/* ---------- API publique ---------- */

/**
 * Lit un texte à voix haute avec la voix choisie.
 * @param {{ voiceURI: string|null, voiceGender: "female"|"male" }} preferences
 * @returns {Promise<void>} résolue à la fin de la lecture ou quand elle est arrêtée
 */
export async function speak(text, preferences, { onStart = () => {} } = {}) {
  if (!text?.trim()) return;
  stopSpeaking();
  const token = speakToken;

  const { description } = await resolveVoice(preferences);
  if (token !== speakToken) return;

  speaking = true;
  onStart();
  try {
    if (description?.engine === "server") {
      const chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH);
      const failure = await speakWithServer(chunks, description.serverVoiceId, token);
      if (failure && token === speakToken) {
        // Serveur injoignable (ou audio bloqué) : on termine avec une voix française du navigateur.
        if (failure.serverFailed) serverUnavailableUntil = Date.now() + SERVER_RETRY_DELAY_MS;
        await speakWithBrowser(chunks.slice(failure.failedAt).join(" "), preferences, token);
      }
    } else {
      await speakWithBrowser(text, preferences, token);
    }
  } finally {
    if (token === speakToken) speaking = false;
  }
}

export function stopSpeaking() {
  speakToken += 1;
  speaking = false;
  if (currentAudio) {
    const audio = currentAudio;
    currentAudio = null;
    audio.pause();
  }
  synth?.cancel();
}
