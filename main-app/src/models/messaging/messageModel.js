/**
 * Accès SQL aux messages et à leurs pièces jointes.
 */

import { queryDatabase } from "../../core/database.js";

const MESSAGE_COLUMNS = `
  messages.id, messages.conversation_id, messages.sender_technician_id, messages.kind,
  messages.text_content, messages.created_at, sender_accounts.username AS sender_username,
  attachments.id AS attachment_id, attachments.media_type AS attachment_media_type,
  attachments.byte_size AS attachment_byte_size`;

const MESSAGE_SOURCE = `
  main_app.messages AS messages
  LEFT JOIN main_app.comptes AS sender_accounts ON sender_accounts.technician_id = messages.sender_technician_id
  LEFT JOIN main_app.pieces_jointes_message AS attachments ON attachments.message_id = messages.id`;

function toMessage(messageRow, readerTechnicianId) {
  return {
    id: messageRow.id,
    conversationId: messageRow.conversation_id,
    kind: messageRow.kind,
    text: messageRow.text_content,
    sender: { technicianId: messageRow.sender_technician_id, username: messageRow.sender_username },
    // Calculé par le serveur : la page n'a pas besoin de connaître l'identité de l'utilisateur.
    isOwnMessage: messageRow.sender_technician_id === readerTechnicianId,
    createdAt: messageRow.created_at,
    attachment: messageRow.attachment_id
      ? {
          id: messageRow.attachment_id,
          mediaType: messageRow.attachment_media_type,
          byteSize: messageRow.attachment_byte_size,
          url: `/api/messaging/attachments/${messageRow.attachment_id}`,
        }
      : null,
  };
}

/** Les `limit` derniers messages, du plus ancien au plus récent (ouverture d'une conversation). */
export async function findLatestMessages(conversationId, readerTechnicianId, limit) {
  const messageRows = await queryDatabase(
    `SELECT * FROM (
        SELECT ${MESSAGE_COLUMNS} FROM ${MESSAGE_SOURCE}
         WHERE messages.conversation_id = $1
         ORDER BY messages.id DESC
         LIMIT $2) AS latest_messages
      ORDER BY id`,
    [conversationId, limit],
  );
  return messageRows.map((messageRow) => toMessage(messageRow, readerTechnicianId));
}

/** Messages arrivés après `afterMessageId` (polling), du plus ancien au plus récent. */
export async function findMessagesAfter(conversationId, readerTechnicianId, afterMessageId, limit) {
  const messageRows = await queryDatabase(
    `SELECT ${MESSAGE_COLUMNS} FROM ${MESSAGE_SOURCE}
      WHERE messages.conversation_id = $1 AND messages.id > $2
      ORDER BY messages.id
      LIMIT $3`,
    [conversationId, afterMessageId, limit],
  );
  return messageRows.map((messageRow) => toMessage(messageRow, readerTechnicianId));
}

export async function findMessageById(messageId, readerTechnicianId) {
  const [messageRow] = await queryDatabase(`SELECT ${MESSAGE_COLUMNS} FROM ${MESSAGE_SOURCE} WHERE messages.id = $1`, [messageId]);
  return messageRow ? toMessage(messageRow, readerTechnicianId) : null;
}

export async function insertMessage({ conversationId, senderTechnicianId, kind, textContent }, databaseClient) {
  const [createdRow] = await queryDatabase(
    `INSERT INTO main_app.messages (conversation_id, sender_technician_id, kind, text_content)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [conversationId, senderTechnicianId, kind, textContent],
    databaseClient,
  );
  return createdRow.id;
}

export async function insertMessageAttachment({ messageId, storageFileName, mediaType, byteSize }, databaseClient) {
  await queryDatabase(
    `INSERT INTO main_app.pieces_jointes_message (message_id, storage_file_name, media_type, byte_size)
     VALUES ($1, $2, $3, $4)`,
    [messageId, storageFileName, mediaType, byteSize],
    databaseClient,
  );
}

/** La pièce jointe et sa conversation : la conversation sert à vérifier que le demandeur y participe. */
export async function findAttachmentWithConversation(attachmentId) {
  const [attachmentRow] = await queryDatabase(
    `SELECT attachments.storage_file_name, attachments.media_type, attachments.byte_size, messages.conversation_id
       FROM main_app.pieces_jointes_message AS attachments
       JOIN main_app.messages AS messages ON messages.id = attachments.message_id
      WHERE attachments.id = $1`,
    [attachmentId],
  );
  return attachmentRow
    ? {
        storageFileName: attachmentRow.storage_file_name,
        mediaType: attachmentRow.media_type,
        byteSize: attachmentRow.byte_size,
        conversationId: attachmentRow.conversation_id,
      }
    : null;
}

/** Noms de fichiers connus en base (job de nettoyage des fichiers orphelins). */
export async function findKnownStorageFileNames(storageFileNames) {
  const knownRows = await queryDatabase(
    "SELECT storage_file_name FROM main_app.pieces_jointes_message WHERE storage_file_name = ANY($1::text[])",
    [storageFileNames],
  );
  return new Set(knownRows.map((knownRow) => knownRow.storage_file_name));
}
