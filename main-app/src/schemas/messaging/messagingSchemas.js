/**
 * Validation des entrées de la messagerie.
 *
 * Un message est du TEXTE BRUT : on le garde tel quel (emojis, accents,
 * « <b> » compris), sans échappement ni nettoyage HTML. La sécurité vient de
 * l'affichage : textContent uniquement, côté page. On refuse seulement les
 * caractères de contrôle invisibles (sauf le retour à la ligne) et les
 * caractères d'inversion du sens du texte, qui servent à maquiller un message.
 */

import { z } from "zod";

export const MAXIMUM_MESSAGE_LENGTH = 2000;
export const MESSAGES_PER_PAGE = 50;

// eslint-disable-next-line no-control-regex -- c'est justement le but : détecter ces caractères.
const FORBIDDEN_INVISIBLE_CHARACTERS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/u;

/** Texte d'un message : retours à la ligne normalisés, longueur comptée en caractères affichés (un emoji = 1). */
function messageTextSchema({ allowEmpty }) {
  return z
    .string({ error: "texte attendu" })
    .transform((text) => text.replace(/\r\n?/g, "\n"))
    .refine((text) => !FORBIDDEN_INVISIBLE_CHARACTERS.test(text), "caractères de contrôle interdits")
    .refine((text) => [...text].length <= MAXIMUM_MESSAGE_LENGTH, `${MAXIMUM_MESSAGE_LENGTH} caractères maximum`)
    .refine((text) => allowEmpty || text.trim().length > 0, "message vide");
}

export const textMessageRequestSchema = z.object({ text: messageTextSchema({ allowEmpty: false }) });

/** Légende facultative d'une pièce jointe (champ texte du formulaire multipart). */
export const attachmentCaptionSchema = messageTextSchema({ allowEmpty: true }).default("");

export const directConversationRequestSchema = z.object({
  participantTechnicianId: z.number({ error: "nombre attendu" }).int().positive(),
});

export const conversationIdParametersSchema = z.object({
  conversationId: z.coerce.number().int().positive(),
});

export const attachmentIdParametersSchema = z.object({ attachmentId: z.uuid("identifiant de pièce jointe invalide") });

/** Polling : `after` = dernier id déjà affiché. Sans `after` : les derniers messages. */
export const messagePageQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
});

export const readReceiptRequestSchema = z.object({
  lastReadMessageId: z.number().int().min(0),
});

export const contactSearchQuerySchema = z.object({
  search: z.string().trim().max(30).default(""),
});
