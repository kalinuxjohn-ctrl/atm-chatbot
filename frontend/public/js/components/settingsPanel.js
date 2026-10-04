/**
 * Panneau de paramètres du Copilote : avatar, voix française, conversation.
 * Chaque modification est enregistrée IMMÉDIATEMENT (localStorage via
 * preferencesService) : pas de bouton "Enregistrer" à oublier.
 *
 * La liste des voix ne montre QUE les voix françaises réellement installées
 * dans le navigateur / le système, groupées par région : "Français (France)"...
 */

import { getPreferences, onPreferencesChange, updatePreferences } from "../services/preferencesService.js";
import { isSpeechRecognitionSupported } from "../services/speech/speechRecognitionService.js";
import {
  isSpeechSynthesisSupported,
  listFrenchVoices,
  resolveVoice,
  speak,
} from "../services/speech/speechSynthesisService.js";
import { createElement } from "../utils/dom.js";
import { AVATARS, renderAvatar } from "./avatar.js";

const GENDER_ADJECTIVES = { female: "féminine", male: "masculine" };

/** "Denise — Féminine · naturelle" */
export function formatVoiceLabel(description) {
  const parts = [description.shortName];
  if (description.gender !== "unknown") parts.push(`— ${description.genderLabel}`);
  if (description.isNatural) parts.push("· naturelle");
  return parts.join(" ");
}

export function createSettingsPanel({ dialog }) {
  const form = dialog.querySelector("form");
  const avatarChoices = dialog.querySelector("[data-avatar-choices]");
  const voiceSelect = dialog.querySelector("[data-voice-select]");
  const activeVoiceElement = dialog.querySelector("[data-voice-active]");
  const voiceWarning = dialog.querySelector("[data-voice-warning]");
  const testVoiceButton = dialog.querySelector("[data-voice-test]");
  const voiceSection = dialog.querySelector("[data-voice-section]");
  const recognitionNote = dialog.querySelector("[data-recognition-note]");

  /* --- Choix d'avatar (construits une seule fois) --- */

  Object.entries(AVATARS).forEach(([key, avatar]) => {
    const label = createElement("label", "avatar-choice");
    const input = createElement("input");
    input.type = "radio";
    input.name = "avatar";
    input.value = key;
    label.append(input, renderAvatar(key), createElement("span", "", avatar.label));
    avatarChoices.append(label);
  });

  /* --- Voix françaises --- */

  async function fillVoiceOptions() {
    const { voiceGender } = getPreferences();
    const voices = await listFrenchVoices();

    const automatic = createElement("option", "", `Automatique : meilleure voix ${GENDER_ADJECTIVES[voiceGender]} française`);
    automatic.value = "";
    voiceSelect.replaceChildren(automatic);

    const groups = new Map();
    voices.forEach((description) => {
      const groupLabel = description.group || description.languageLabel;
      if (!groups.has(groupLabel)) {
        const group = createElement("optgroup");
        group.label = groupLabel;
        groups.set(groupLabel, group);
        voiceSelect.append(group);
      }
      const option = createElement("option", "", formatVoiceLabel(description));
      option.value = description.voiceURI;
      option.dataset.gender = description.gender;
      groups.get(groupLabel).append(option);
    });

    const { voiceURI } = getPreferences();
    voiceSelect.value = voices.some((voice) => voice.voiceURI === voiceURI) ? voiceURI : "";
    await renderActiveVoice(voices);
  }

  /** Affiche la voix VRAIMENT utilisée et prévient si le choix ne peut pas être respecté. */
  async function renderActiveVoice(frenchVoices) {
    const preferences = getPreferences();
    const { description, genderMatched } = await resolveVoice(preferences);
    voiceWarning.hidden = true;

    if (!description) {
      activeVoiceElement.textContent = "Voix utilisée : voix par défaut du système";
      voiceWarning.textContent =
        "Aucune voix française disponible : la synthèse vocale du serveur est injoignable et ce navigateur n’a pas de voix française. Vérifiez la connexion Internet du serveur frontend, ou installez une voix française dans Windows (Paramètres › Heure et langue › Voix).";
      voiceWarning.hidden = false;
      return;
    }

    activeVoiceElement.textContent = `Voix utilisée : ${formatVoiceLabel(description)} · ${description.languageLabel}`;
    if (!genderMatched && frenchVoices.length > 0) {
      voiceWarning.textContent = `Aucune voix ${GENDER_ADJECTIVES[preferences.voiceGender]} française n’est disponible pour le moment (synthèse du serveur injoignable) : la voix ${description.shortName} est utilisée avec une tonalité ajustée.`;
      voiceWarning.hidden = false;
    }
  }

  /** Recopie les préférences enregistrées dans le formulaire. */
  function syncForm() {
    const preferences = getPreferences();
    form.elements.avatar.value = preferences.avatar;
    form.elements.voiceGender.value = preferences.voiceGender;
    form.elements.voiceModeEnabled.checked = preferences.voiceModeEnabled;
    form.elements.autoRead.checked = preferences.autoRead;
  }

  /* --- Enregistrement immédiat de chaque modification --- */

  form.addEventListener("change", (event) => {
    const { name, value, checked } = event.target;
    if (name === "avatar") updatePreferences({ avatar: value });
    if (name === "voiceGender") {
      // Nouveau genre : on repasse en choix automatique d'une voix de ce genre.
      updatePreferences({ voiceGender: value, voiceURI: null });
      void fillVoiceOptions();
    }
    if (name === "voiceURI") {
      const gender = event.target.selectedOptions[0]?.dataset.gender;
      const changes = { voiceURI: value || null };
      // Une voix précise choisie : le type de voix suit (si son genre est connu).
      if (gender === "female" || gender === "male") changes.voiceGender = gender;
      updatePreferences(changes);
      form.elements.voiceGender.value = getPreferences().voiceGender;
      void fillVoiceOptions();
    }
    if (name === "voiceModeEnabled") updatePreferences({ voiceModeEnabled: checked });
    if (name === "autoRead") updatePreferences({ autoRead: checked });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    dialog.close();
  });

  testVoiceButton.addEventListener("click", () => {
    void speak("Bonjour, je suis votre Copilote de maintenance. Voici la voix que j’utiliserai pour vous répondre.", getPreferences());
  });

  /* --- Fonctions non supportées par le navigateur --- */

  if (!isSpeechSynthesisSupported()) {
    voiceSection.classList.add("is-unsupported");
    voiceSection.querySelectorAll("input, select, button").forEach((element) => (element.disabled = true));
  } else {
    void fillVoiceOptions();
    // Edge et Chrome ajoutent parfois leurs voix en ligne après le chargement de la page.
    window.speechSynthesis.addEventListener("voiceschanged", () => void fillVoiceOptions());
  }
  recognitionNote.hidden = isSpeechRecognitionSupported();
  onPreferencesChange(syncForm);

  return {
    open() {
      syncForm();
      if (isSpeechSynthesisSupported()) void fillVoiceOptions();
      dialog.showModal();
    },
  };
}
