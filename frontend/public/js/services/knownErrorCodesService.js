/**
 * Codes d'erreur fréquents et leurs réponses ENREGISTRÉES côté frontend.
 *
 *   public/data/error-codes/index.json   ─> liste des fichiers à charger
 *   public/data/error-codes/E42.json ... ─> un fichier par code (code, équipement, bulle, réponse)
 *
 * Aucun appel au backend : les fichiers sont servis tels quels par le serveur
 * frontend. Pour ajouter / modifier un code : voir public/data/error-codes/README.md.
 */

import { KNOWN_ERROR_CODES_DIRECTORY } from "../config.js";
import { getStaticJson } from "../core/httpClient.js";

const LOG_PREFIX = "[codes d'erreur]";
const DEVICE_TYPES = ["gab", "tpe"];

/**
 * @typedef {{ code: string, deviceType: "gab"|"tpe", label: string, replyText: string }} KnownErrorCode
 */

// Chargés UNE seule fois par page : les fichiers ne changent pas pendant la session.
let loadingPromise = null;

/**
 * Tous les codes d'erreur valides, dans l'ordre de index.json.
 * Ne lève jamais : un fichier absent ou mal rempli est ignoré (raison dans la console),
 * pour qu'une faute de frappe dans un JSON ne casse pas tout le Copilote.
 * @returns {Promise<KnownErrorCode[]>}
 */
export function loadKnownErrorCodes() {
  loadingPromise ??= loadAllFiles();
  return loadingPromise;
}

/** Codes d'erreur à proposer pour l'équipement sélectionné (GAB ou TPE). */
export function filterErrorCodesForDevice(knownErrorCodes, deviceType) {
  return knownErrorCodes.filter((errorCode) => errorCode.deviceType === deviceType);
}

async function loadAllFiles() {
  let fileNames;
  try {
    ({ files: fileNames } = await fetchJson("index.json"));
    if (!Array.isArray(fileNames)) throw new Error("le champ \"files\" doit être une liste de noms de fichiers");
  } catch (error) {
    console.warn(`${LOG_PREFIX} index.json illisible, aucune suggestion de code d'erreur :`, error.message);
    return [];
  }

  // Chargement en parallèle ; Promise.all garde l'ordre de index.json.
  const loaded = await Promise.all(fileNames.map(loadOneFile));
  return loaded.filter(Boolean);
}

/** @returns {Promise<KnownErrorCode|null>} null si le fichier est inutilisable */
async function loadOneFile(fileName) {
  try {
    return toKnownErrorCode(await fetchJson(fileName));
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${fileName} ignoré :`, error.message);
    return null;
  }
}

/** Vérifie le contenu d'un fichier et le convertit au format utilisé par l'interface. */
function toKnownErrorCode(fileContent) {
  const { code, device_type: deviceType, label, reply } = fileContent ?? {};

  if (typeof code !== "string" || !code.trim()) throw new Error("champ \"code\" manquant");
  if (!DEVICE_TYPES.includes(deviceType)) throw new Error(`"device_type" doit valoir "gab" ou "tpe" (reçu : ${deviceType})`);
  if (typeof label !== "string" || !label.trim()) throw new Error("champ \"label\" manquant");

  // "reply" : une liste de paragraphes (plus lisible à éditer dans un JSON),
  // ou un simple texte. Le chat affiche un paragraphe par ligne.
  const paragraphs = Array.isArray(reply) ? reply : [reply];
  const replyText = paragraphs.filter((paragraph) => typeof paragraph === "string" && paragraph.trim()).join("\n");
  if (!replyText) throw new Error("champ \"reply\" vide");

  return { code: code.trim(), deviceType, label: label.trim(), replyText };
}

function fetchJson(fileName) {
  return getStaticJson(`${KNOWN_ERROR_CODES_DIRECTORY}/${fileName}`);
}
