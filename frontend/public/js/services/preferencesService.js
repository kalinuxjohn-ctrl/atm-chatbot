/**
 * Préférences du Copilote, choisies par le technicien et sauvegardées dans
 * le localStorage (conservées d'une session à l'autre). Aucune API backend.
 *
 * L'avatar et la voix sont des CHOIX explicites : rien n'est déduit du
 * profil du technicien.
 */

import { STORAGE_KEYS } from "../config.js";

export const DEFAULT_PREFERENCES = Object.freeze({
  avatar: "female", // clé de AVATARS (components/avatar.js)
  voiceGender: "female", // "female" | "male"
  voiceURI: null, // voix précise du navigateur ; null = choix automatique selon voiceGender
  voiceModeEnabled: true, // affiche les boutons micro et "Chat vocal"
  autoRead: true, // lit les réponses du chat écrit à voix haute
  handsFree: true, // mode vocal : réécoute automatiquement après chaque réponse lue
  sidebarCollapsed: null, // null = selon la largeur d'écran ; true/false = choix du technicien
});

const listeners = new Set();

export function getPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.preferences) || "{}");
    return { ...DEFAULT_PREFERENCES, ...saved };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Enregistre une modification partielle et prévient les abonnés. */
export function updatePreferences(changes) {
  const preferences = { ...getPreferences(), ...changes };
  localStorage.setItem(STORAGE_KEYS.preferences, JSON.stringify(preferences));
  listeners.forEach((listener) => listener(preferences));
  return preferences;
}

/** @returns {() => void} fonction de désabonnement */
export function onPreferencesChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
