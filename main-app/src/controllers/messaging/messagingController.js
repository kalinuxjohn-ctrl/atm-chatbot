/**
 * Messagerie : lecture de la requête, appel du service, réponse JSON.
 * Les pièces jointes sont lues par multer, en mémoire, avec des limites strictes.
 */

import multer from "multer";

import { InvalidReferenceError, PayloadTooLargeError } from "../../core/errors.js";
import { parseWithSchema } from "../../core/validation.js";
import {
  attachmentCaptionSchema,
  attachmentIdParametersSchema,
  contactSearchQuerySchema,
  conversationIdParametersSchema,
  directConversationRequestSchema,
  messagePageQuerySchema,
  readReceiptRequestSchema,
  textMessageRequestSchema,
} from "../../schemas/messaging/messagingSchemas.js";
import {
  ensureUserParticipatesInConversation,
  findAttachmentFileForUser,
  getNotificationState,
  listContacts,
  listConversationsOfUser,
  markConversationAsRead,
  openDirectConversation,
  readMessages,
  sendAttachmentMessage,
  sendTextMessage,
} from "../../services/messaging/messagingService.js";

let attachmentUploadParser = null;

/**
 * Lecteur multipart créé une fois, avec la taille maximale de la configuration.
 * Un seul fichier (champ « file ») et une légende (champ « caption ») : tout
 * autre champ ou fichier est refusé.
 */
function getAttachmentUploadParser(configuration) {
  attachmentUploadParser ??= multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: configuration.MAIN_APP_UPLOAD_MAX_BYTES,
      files: 1,
      fields: 1,
      parts: 2,
      fieldSize: 16 * 1024,
      headerPairs: 20,
    },
  }).single("file");
  return attachmentUploadParser;
}

function parseAttachmentUpload(request, response) {
  return new Promise((resolve, reject) => {
    getAttachmentUploadParser(request.app.locals.configuration)(request, response, (uploadError) => {
      if (!uploadError) {
        resolve();
        return;
      }
      if (uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE") {
        reject(new PayloadTooLargeError("Fichier trop volumineux."));
        return;
      }
      reject(new InvalidReferenceError("Envoi de fichier invalide : un seul fichier (champ « file ») et une légende facultative."));
    });
  });
}

export async function searchContacts(request, response) {
  const { search } = parseWithSchema(contactSearchQuerySchema, request.query);
  response.json({ contacts: await listContacts(request.user, search) });
}

export async function listConversations(request, response) {
  response.json({ conversations: await listConversationsOfUser(request.user) });
}

export async function notificationState(request, response) {
  response.set("Cache-Control", "no-store");
  response.json({ conversations: await getNotificationState(request.user) });
}

export async function openConversation(request, response) {
  const { participantTechnicianId } = parseWithSchema(directConversationRequestSchema, request.body);
  const { conversationId, created } = await openDirectConversation(request.user, participantTechnicianId);
  response.status(created ? 201 : 200).json({ conversationId });
}

export async function listMessages(request, response) {
  const { conversationId } = parseWithSchema(conversationIdParametersSchema, request.params);
  const { after } = parseWithSchema(messagePageQuerySchema, request.query);
  response.json({ messages: await readMessages(request.user, conversationId, after) });
}

export async function postTextMessage(request, response) {
  const { conversationId } = parseWithSchema(conversationIdParametersSchema, request.params);
  const { text } = parseWithSchema(textMessageRequestSchema, request.body);
  response.status(201).json({ message: await sendTextMessage(request.user, conversationId, text) });
}

export async function postAttachmentMessage(request, response) {
  const { conversationId } = parseWithSchema(conversationIdParametersSchema, request.params);
  // Participation vérifiée AVANT de lire le fichier : un non-participant ne fait rien travailler au serveur.
  await ensureUserParticipatesInConversation(request.user, conversationId);
  await parseAttachmentUpload(request, response);
  if (!request.file) {
    throw new InvalidReferenceError("Aucun fichier reçu (champ « file »).");
  }
  const caption = parseWithSchema(attachmentCaptionSchema, request.body?.caption);
  const message = await sendAttachmentMessage(
    request.user,
    conversationId,
    { fileBytes: request.file.buffer, caption },
    request.app.locals.configuration.MAIN_APP_UPLOADS_DIRECTORY,
  );
  response.status(201).json({ message });
}

export async function markAsRead(request, response) {
  const { conversationId } = parseWithSchema(conversationIdParametersSchema, request.params);
  const { lastReadMessageId } = parseWithSchema(readReceiptRequestSchema, request.body);
  await markConversationAsRead(request.user, conversationId, lastReadMessageId);
  response.status(204).end();
}

/**
 * Sert le fichier d'une pièce jointe. En-têtes de défense en profondeur : même
 * si un fichier piégé passait les contrôles, le navigateur ne le
 * réinterpréterait pas (nosniff) et n'y exécuterait rien (CSP sandbox).
 */
export async function downloadAttachment(request, response) {
  const { attachmentId } = parseWithSchema(attachmentIdParametersSchema, request.params);
  const { filePath, mediaType } = await findAttachmentFileForUser(
    request.user,
    attachmentId,
    request.app.locals.configuration.MAIN_APP_UPLOADS_DIRECTORY,
  );
  response.set({
    "Content-Type": mediaType,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": "inline",
    "Cache-Control": "private, max-age=3600",
  });
  response.sendFile(filePath, { dotfiles: "deny" });
}
