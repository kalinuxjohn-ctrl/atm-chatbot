/**
 * Text-to-Speech dans le navigateur (speechSynthesis).
 *
 * Le Copilote parle français : on n'utilise QUE des voix françaises quand il
 * en existe (sinon une voix américaine lirait le français avec son accent).
 * Ordre de choix de la voix :
 *   1. la voix précise choisie dans les paramètres (voiceURI)
 *   2. une voix fr-FR du genre choisi, puis une voix fr-* du genre choisi
 *   3. une voix fr-FR quelconque (hauteur ajustée vers le genre choisi)
 *   4. aucune voix française : voix par défaut du système (cas signalé dans les paramètres)
 *
 * Le genre n'est pas fourni par le navigateur : on le déduit du prénom de la
 * voix (Denise, Henri...). S'il est inconnu, on ne l'invente pas.
 */

import { SPEECH_LANG } from "../../config.js";

const synth = window.speechSynthesis;

const FRENCH_PREFIX = "fr";
const PREFERRED_LANG = SPEECH_LANG.toLowerCase(); // "fr-fr"

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
  "lucien", "christophe", "frederic", "olivier", "pierre", "jacques", "theo", "hugo", "arnaud",
];
// "Google français" est une voix féminine.
const KNOWN_FEMALE_VOICES = ["google francais"];

// Si la voix française disponible n'a pas le genre demandé, on rapproche sa hauteur.
const FALLBACK_PITCH = { female: 1.18, male: 0.82 };

// Chrome coupe les lectures longues (~15 s) : on lit phrase par phrase.
const MAX_CHUNK_LENGTH = 220;

export const GENDER_LABELS = Object.freeze({ female: "Féminine", male: "Masculine", unknown: "Genre non précisé" });

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["fr"], { type: "region" }) : null;

let speakToken = 0;
let speaking = false;

export function isSpeechSynthesisSupported() {
  return Boolean(synth);
}

export function isSpeaking() {
  return speaking;
}

const normalize = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const isFrench = (voice) => voice.lang.toLowerCase().replace("_", "-").startsWith(FRENCH_PREFIX);
const isPreferredLang = (voice) => voice.lang.toLowerCase().replace("_", "-") === PREFERRED_LANG;

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
 * Décrit une voix pour l'affichage.
 * @returns {{ voice: SpeechSynthesisVoice, voiceURI: string, shortName: string, gender: string,
 *             genderLabel: string, languageLabel: string, isNatural: boolean }}
 */
export function describeVoice(voice) {
  const gender = classifyVoice(voice);
  return {
    voice,
    voiceURI: voice.voiceURI,
    shortName: extractShortName(voice),
    gender,
    genderLabel: GENDER_LABELS[gender],
    languageLabel: isFrench(voice) ? describeLanguage(voice.lang) : voice.lang,
    isNatural: /natural|neural|online|enhanced|premium/i.test(voice.name) || voice.localService === false,
  };
}

function loadVoices() {
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

/** Voix françaises, fr-FR d'abord, puis voix naturelles, puis ordre alphabétique. */
export async function listFrenchVoices() {
  const voices = (await loadVoices()).filter(isFrench).map(describeVoice);
  return voices.sort(
    (a, b) =>
      Number(isPreferredLang(b.voice)) - Number(isPreferredLang(a.voice)) ||
      a.languageLabel.localeCompare(b.languageLabel, "fr") ||
      Number(b.isNatural) - Number(a.isNatural) ||
      a.shortName.localeCompare(b.shortName, "fr"),
  );
}

/**
 * Voix réellement utilisée pour des préférences données.
 * @returns {Promise<{ description: ReturnType<typeof describeVoice>|null, pitch: number, genderMatched: boolean }>}
 */
export async function resolveVoice({ voiceURI, voiceGender }) {
  const allVoices = await loadVoices();
  const exact = voiceURI && allVoices.find((voice) => voice.voiceURI === voiceURI);
  if (exact) return { description: describeVoice(exact), pitch: 1, genderMatched: true };

  const french = await listFrenchVoices(); // déjà triées : fr-FR et voix naturelles d'abord
  const matching = french.find((voice) => voice.gender === voiceGender);
  if (matching) return { description: matching, pitch: 1, genderMatched: true };

  const fallback = french.find((voice) => voice.gender === "unknown") || french[0] || null;
  return { description: fallback, pitch: FALLBACK_PITCH[voiceGender] ?? 1, genderMatched: false };
}

/** Découpe le texte en morceaux courts, sur les fins de phrase. */
function splitIntoChunks(text) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?;:\n]+[.!?;:]*|\S+/g) || [];
  const chunks = [];
  let current = "";
  sentences.forEach((sentence) => {
    const candidate = `${current} ${sentence}`.trim();
    if (candidate.length > MAX_CHUNK_LENGTH && current) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = candidate;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

function speakChunk(text, voice, pitch) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang || SPEECH_LANG;
    if (voice) utterance.voice = voice;
    utterance.pitch = pitch;
    utterance.rate = 1;
    utterance.onend = resolve;
    utterance.onerror = resolve; // "interrupted" lors d'un arrêt volontaire : rien à signaler
    synth.speak(utterance);
  });
}

/**
 * Lit un texte à voix haute avec la voix choisie.
 * @param {{ voiceURI: string|null, voiceGender: "female"|"male" }} preferences
 * @returns {Promise<void>} résolue à la fin de la lecture ou quand elle est arrêtée
 */
export async function speak(text, preferences, { onStart = () => {} } = {}) {
  if (!synth || !text?.trim()) return;
  synth.cancel();
  const token = ++speakToken;

  const { description, pitch } = await resolveVoice(preferences);
  if (token !== speakToken) return;

  speaking = true;
  onStart();
  try {
    for (const chunk of splitIntoChunks(text)) {
      if (token !== speakToken) break;
      await speakChunk(chunk, description?.voice ?? null, pitch);
    }
  } finally {
    if (token === speakToken) speaking = false;
  }
}

export function stopSpeaking() {
  speakToken += 1;
  speaking = false;
  synth?.cancel();
}
