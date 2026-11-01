/**
 * Contrôle d'une pièce jointe AVANT tout enregistrement.
 *
 * 1. Le VRAI type est lu dans les premiers octets du fichier (signature,
 *    librairie file-type). L'extension et le Content-Type envoyés par le
 *    navigateur sont ignorés : ils sont choisis par le client.
 * 2. Liste blanche : images JPEG, PNG, WebP, GIF ; audio MP3, OGG/Opus,
 *    WebM, M4A. SVG exclu (c'est du XML qui peut contenir du script) : il
 *    n'a d'ailleurs pas de signature binaire et est donc toujours refusé.
 *    Pas de vidéo.
 * 3. Les images sont RÉ-ENCODÉES (sharp) : les métadonnées EXIF, dont la
 *    position GPS de la prise de vue, disparaissent, et un fichier piégé
 *    déguisé en image ne survit pas au décodage.
 */

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { InvalidReferenceError } from "../../core/errors.js";

/**
 * Types reconnus par file-type -> type enregistré et servi.
 * Les conteneurs WebM et MP4 sont aussi ceux de la vidéo : un enregistrement
 * vocal du navigateur (MediaRecorder) arrive en audio/webm (Chrome, Firefox)
 * ou en audio/mp4 (Safari). Ils sont acceptés comme AUDIO et toujours servis
 * avec un type audio/..., donc lus par un lecteur audio qui n'affiche aucune
 * image (limite documentée dans docs/main-app.md).
 */
const ALLOWED_ATTACHMENT_TYPES_BY_DETECTED_MEDIA_TYPE = {
  "image/jpeg": { kind: "image", storedMediaType: "image/jpeg", sharpOutputFormat: "jpeg" },
  "image/png": { kind: "image", storedMediaType: "image/png", sharpOutputFormat: "png" },
  "image/webp": { kind: "image", storedMediaType: "image/webp", sharpOutputFormat: "webp" },
  "image/gif": { kind: "image", storedMediaType: "image/gif", sharpOutputFormat: "gif" },
  "audio/mpeg": { kind: "audio", storedMediaType: "audio/mpeg" },
  "audio/ogg": { kind: "audio", storedMediaType: "audio/ogg" },
  "audio/opus": { kind: "audio", storedMediaType: "audio/ogg" },
  "audio/webm": { kind: "audio", storedMediaType: "audio/webm" },
  "video/webm": { kind: "audio", storedMediaType: "audio/webm" },
  "audio/x-m4a": { kind: "audio", storedMediaType: "audio/mp4" },
  "audio/mp4": { kind: "audio", storedMediaType: "audio/mp4" },
  "video/mp4": { kind: "audio", storedMediaType: "audio/mp4" },
};

// Au-delà, une image (même petite en octets) demanderait trop de mémoire à décoder.
const MAXIMUM_IMAGE_PIXELS = 40_000_000;
const MAXIMUM_STORED_IMAGE_SIDE_PIXELS = 2560;

export async function detectAllowedAttachmentType(fileBytes) {
  const detectedFileType = await fileTypeFromBuffer(fileBytes);
  const allowedType = detectedFileType ? ALLOWED_ATTACHMENT_TYPES_BY_DETECTED_MEDIA_TYPE[detectedFileType.mime] : undefined;
  if (!allowedType) {
    throw new InvalidReferenceError("Type de fichier refusé : images JPEG, PNG, WebP, GIF ou audio MP3, OGG, WebM, M4A uniquement.");
  }
  return allowedType;
}

/**
 * Image ré-encodée dans son format d'origine, orientée correctement (l'EXIF
 * d'orientation est appliqué avant d'être supprimé), réduite si très grande.
 */
export async function reencodeImageWithoutMetadata(fileBytes, sharpOutputFormat) {
  try {
    const isAnimatedGif = sharpOutputFormat === "gif";
    return await sharp(fileBytes, { animated: isAnimatedGif, limitInputPixels: MAXIMUM_IMAGE_PIXELS })
      .rotate()
      .resize({
        width: MAXIMUM_STORED_IMAGE_SIDE_PIXELS,
        height: MAXIMUM_STORED_IMAGE_SIDE_PIXELS,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(sharpOutputFormat, sharpOutputFormat === "jpeg" || sharpOutputFormat === "webp" ? { quality: 85 } : {})
      .toBuffer();
  } catch {
    // Signature d'image valide, mais contenu impossible à décoder : fichier corrompu ou piégé.
    throw new InvalidReferenceError("Image illisible ou corrompue.");
  }
}

/** Contrôle complet : renvoie le type de message, le type enregistré et les octets à stocker. */
export async function prepareAttachmentForStorage(fileBytes) {
  const allowedType = await detectAllowedAttachmentType(fileBytes);
  const bytesToStore =
    allowedType.kind === "image" ? await reencodeImageWithoutMetadata(fileBytes, allowedType.sharpOutputFormat) : fileBytes;
  return { messageKind: allowedType.kind, mediaType: allowedType.storedMediaType, bytesToStore };
}
