/**
 * API du mode vocal.
 *
 * La reconnaissance (Speech-to-Text) et la lecture (Text-to-Speech) restent
 * dans le navigateur : le backend ne reçoit que du TEXTE. On réutilise donc
 * l'API réelle POST /chat (via chatApi).
 *
 * ⏳ Aucune route vocale dédiée n'existe (pas de /api/voice).
 * TODO: si le backend propose un jour une réponse audio (voix serveur),
 *       appeler cette route ici et remplir `audio`. Le reste de
 *       l'application n'aura rien à changer.
 */

import { FORCE_MOCKS } from "../../config.js";
import { sendMessage } from "./chatApi.js";
import { mockVoiceResponse } from "./mocks.js";

/**
 * @returns {Promise<{conversationId: number, text: string, audio: null}>}
 *          audio = null : la voix est générée par le navigateur.
 */
export async function processVoiceConversation({ transcript, technicianId, conversationId = null, deviceType = null }) {
  if (FORCE_MOCKS) {
    const mock = await mockVoiceResponse({ conversationId });
    return { conversationId: mock.conversation_id, text: mock.text, audio: mock.audio };
  }

  const { conversationId: id, reply } = await sendMessage({
    message: transcript,
    technicianId,
    conversationId,
    deviceType,
  });
  return { conversationId: id, text: reply, audio: null };
}
