/**
 * Photo jointe au message (bouton appareil photo du chat écrit).
 *
 *   clic ─> appareil photo du téléphone (sur PC : choix d'un fichier)
 *       ─> photo réduite (côté le plus long : 1568 px, JPEG) ─> aperçu sous la zone de saisie
 *       ─> envoyée avec le prochain message, puis retirée de l'aperçu
 *
 * Le backend n'en lit que le texte affiché (OCR par Claude) : la photo n'est
 * jamais enregistrée, ni ici ni côté serveur.
 * Le bouton n'apparaît que si le backend a la fonctionnalité active (photoApi.js).
 */

import { createElement } from "../utils/dom.js";
import { createIcon } from "./icons.js";

// Au-delà, Claude réduit lui-même l'image : l'envoyer plus grande ne lit pas mieux le texte.
const MAX_SIDE_PX = 1568;
const JPEG_QUALITY = 0.85;

/**
 * @param {{ button: HTMLButtonElement, fileInput: HTMLInputElement, preview: HTMLElement, onChange: () => void }} options
 */
export function createComposerPhoto({ button, fileInput, preview, onChange }) {
  /** @type {{ mediaType: string, dataBase64: string, previewUrl: string } | null} */
  let photo = null;

  function render() {
    preview.hidden = !photo;
    if (!photo) {
      preview.replaceChildren();
      return;
    }
    const image = createElement("img", "composer-photo-thumbnail");
    image.src = photo.previewUrl;
    image.alt = "Photo jointe";
    const label = createElement("span", "composer-photo-label", "Photo jointe : le Copilote lira le texte affiché");
    const removeButton = createElement("button", "composer-photo-remove");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", "Retirer la photo");
    removeButton.title = "Retirer la photo";
    removeButton.append(createIcon("close"));
    removeButton.addEventListener("click", () => setPhoto(null));
    preview.replaceChildren(image, label, removeButton);
  }

  function showError(text) {
    preview.hidden = false;
    preview.replaceChildren(createElement("span", "composer-photo-error", text));
  }

  function setPhoto(nextPhoto) {
    photo = nextPhoto;
    render();
    onChange();
  }

  button.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // la même photo pourra être reprise
    if (!file) return;
    try {
      setPhoto(await shrinkPhoto(file));
    } catch (error) {
      console.warn("[photo] Photo illisible :", error);
      setPhoto(null);
      showError("Cette photo n’a pas pu être ouverte. Reprenez-la ou choisissez une image JPEG ou PNG.");
    }
  });

  return {
    /** Photo prête à envoyer, au format du backend ({ media_type, data_base64 }), ou null. */
    get photo() {
      return photo ? { media_type: photo.mediaType, data_base64: photo.dataBase64 } : null;
    },
    clear() {
      setPhoto(null);
    },
    /** Affiche le bouton seulement si le backend accepte les photos. */
    setAvailable(isAvailable) {
      button.hidden = !isAvailable;
      if (!isAvailable) setPhoto(null);
    },
    setDisabled(isDisabled) {
      button.disabled = isDisabled;
    },
  };
}

/** Réduit la photo (les photos de téléphone font plusieurs Mo) et la convertit en JPEG base64. */
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { mediaType: "image/jpeg", dataBase64: dataUrl.split(",")[1], previewUrl: dataUrl };
}
