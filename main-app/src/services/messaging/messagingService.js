/**
 * Règles de la messagerie.
 *
 * Flux classique : la page envoie le message au backend (POST), qui le
 * valide, l'enregistre, et le destinataire le récupère en interrogeant le
 * backend (polling). Aucun service tiers, aucune clé côté navigateur.
 *
 * Règle de sécurité appliquée PARTOUT : l'utilisateur doit participer à la
 * conversation. Sinon on répond « introuvable » (404), sans confirmer
 * qu'une conversation existe avec cet identifiant.
 */

import { runInTransaction } from "../../core/database.js";
import { InvalidReferenceError, ReferenceNotFoundError } from "../../core/errors.js";
import { trace } from "../../core/tracing.js";
import {
  activeAccountExists,
  buildDirectParticipantsKey,
  findConversationsByTechnicianId,
  findDirectConversationIdByKey,
  findMessagingContacts,
  insertDirectConversation,
  isParticipantOfConversation,
  touchConversationLastMessageAt,
  updateLastReadMessageId,
} from "../../models/messaging/conversationModel.js";
import {
  findAttachmentWithConversation,
  findLatestMessages,
  findMessageById,
  findMessagesAfter,
  insertMessage,
  insertMessageAttachment,
} from "../../models/messaging/messageModel.js";
import { MESSAGES_PER_PAGE } from "../../schemas/messaging/messagingSchemas.js";
import { deleteAttachmentFile, resolveStoredFilePath, writeAttachmentFile } from "./attachmentStorageService.js";
import { prepareAttachmentForStorage } from "./attachmentValidationService.js";

export async function ensureUserParticipatesInConversation(user, conversationId) {
  if (!(await isParticipantOfConversation(conversationId, user.technicianId))) {
    throw new ReferenceNotFoundError("Conversation introuvable.");
  }
}

export async function listContacts(user, searchText) {
  return findMessagingContacts(user.technicianId, searchText);
}

export async function listConversationsOfUser(user) {
  return findConversationsByTechnicianId(user.technicianId);
}

/** Ouvre (ou retrouve) la conversation directe avec un autre technicien qui a un compte actif. */
export async function openDirectConversation(user, participantTechnicianId) {
  if (participantTechnicianId === user.technicianId) {
    throw new InvalidReferenceError("Impossible d'ouvrir une conversation avec soi-même.");
  }
  if (!(await activeAccountExists(participantTechnicianId))) {
    throw new ReferenceNotFoundError("Destinataire introuvable.");
  }
  const directParticipantsKey = buildDirectParticipantsKey(user.technicianId, participantTechnicianId);
  const existingConversationId = await findDirectConversationIdByKey(directParticipantsKey);
  if (existingConversationId) {
    return { conversationId: existingConversationId, created: false };
  }
  const createdConversationId = await runInTransaction((databaseClient) =>
    insertDirectConversation(directParticipantsKey, [user.technicianId, participantTechnicianId], databaseClient),
  );
  // null : l'autre personne l'a créée au même instant ; on reprend la sienne.
  const conversationId = createdConversationId ?? (await findDirectConversationIdByKey(directParticipantsKey));
  trace("MESSAGING", "Conversation directe ouverte", { conversationId, created: createdConversationId !== null });
  return { conversationId, created: createdConversationId !== null };
}

/** Sans `afterMessageId` : les derniers messages. Avec : seulement les nouveaux (polling). */
export async function readMessages(user, conversationId, afterMessageId) {
  await ensureUserParticipatesInConversation(user, conversationId);
  return afterMessageId === undefined
    ? findLatestMessages(conversationId, user.technicianId, MESSAGES_PER_PAGE)
    : findMessagesAfter(conversationId, user.technicianId, afterMessageId, MESSAGES_PER_PAGE * 2);
}

export async function sendTextMessage(user, conversationId, text) {
  await ensureUserParticipatesInConversation(user, conversationId);
  const messageId = await runInTransaction(async (databaseClient) => {
    const createdMessageId = await insertMessage(
      { conversationId, senderTechnicianId: user.technicianId, kind: "text", textContent: text },
      databaseClient,
    );
    await touchConversationLastMessageAt(conversationId, databaseClient);
    return createdMessageId;
  });
  // Ni le texte ni sa longueur exacte dans les traces : seulement des identifiants.
  trace("MESSAGING", "Message envoyé", { conversationId, messageId, kind: "text" });
  return findMessageById(messageId, user.technicianId);
}

/**
 * Pièce jointe : contrôle du vrai type et ré-encodage AVANT d'écrire quoi que
 * ce soit ; le fichier est écrit, puis le message et sa pièce jointe sont
 * enregistrés en une transaction. Si la base échoue, le fichier est supprimé
 * (et sinon, le job cleanupOrphanUploads le supprimera).
 */
export async function sendAttachmentMessage(user, conversationId, { fileBytes, caption }, uploadsDirectory) {
  await ensureUserParticipatesInConversation(user, conversationId);
  const { messageKind, mediaType, bytesToStore } = await prepareAttachmentForStorage(fileBytes);
  const storageFileName = await writeAttachmentFile(uploadsDirectory, bytesToStore);
  let messageId;
  try {
    messageId = await runInTransaction(async (databaseClient) => {
      const createdMessageId = await insertMessage(
        { conversationId, senderTechnicianId: user.technicianId, kind: messageKind, textContent: caption },
        databaseClient,
      );
      await insertMessageAttachment(
        { messageId: createdMessageId, storageFileName, mediaType, byteSize: bytesToStore.length },
        databaseClient,
      );
      await touchConversationLastMessageAt(conversationId, databaseClient);
      return createdMessageId;
    });
  } catch (error) {
    await deleteAttachmentFile(uploadsDirectory, storageFileName).catch(() => {});
    throw error;
  }
  trace("MESSAGING", "Pièce jointe envoyée", { conversationId, messageId, kind: messageKind, mediaType, byteSize: bytesToStore.length });
  return findMessageById(messageId, user.technicianId);
}

export async function markConversationAsRead(user, conversationId, lastReadMessageId) {
  await ensureUserParticipatesInConversation(user, conversationId);
  await updateLastReadMessageId(conversationId, user.technicianId, lastReadMessageId);
}

/** Fichier d'une pièce jointe, seulement pour un participant de sa conversation. */
export async function findAttachmentFileForUser(user, attachmentId, uploadsDirectory) {
  const attachment = await findAttachmentWithConversation(attachmentId);
  if (!attachment || !(await isParticipantOfConversation(attachment.conversationId, user.technicianId))) {
    throw new ReferenceNotFoundError("Pièce jointe introuvable.");
  }
  return {
    filePath: resolveStoredFilePath(uploadsDirectory, attachment.storageFileName),
    mediaType: attachment.mediaType,
    byteSize: attachment.byteSize,
  };
}
