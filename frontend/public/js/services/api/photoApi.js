/**
 * Photos du chat : la fonctionnalité est-elle active côté backend ?
 * ✅ API RÉELLE : GET /api/chat/photo-ocr  -> { enabled: boolean }
 *    enabled = false quand PHOTO_OCR_ENABLED=false dans le .env du backend
 *    (ou quand le LLM n'est pas Claude) : le bouton photo reste alors caché.
 *
 * La photo elle-même part avec le message (POST /api/chat, voir chatApi.js).
 */

import { FORCE_MOCKS } from "../../config.js";
import { getJson } from "../../core/httpClient.js";

/** Ne lève jamais : en cas de doute (mode démo, backend injoignable), pas de bouton photo. */
export async function isPhotoOcrEnabled() {
  if (FORCE_MOCKS) return false;
  try {
    const payload = await getJson("/chat/photo-ocr");
    return payload?.enabled === true;
  } catch (error) {
    console.warn("[photo] Disponibilité de la fonctionnalité inconnue, bouton photo masqué :", error);
    return false;
  }
}
