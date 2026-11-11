/**
 * Accès SQL aux conversations et à leurs participants.
 * Le nom affiché d'un participant est son nom d'utilisateur (main_app.comptes).
 */

import { queryDatabase } from "../../core/database.js";

/** Clé unique d'une conversation directe : le même couple donne toujours la même clé. */
export function buildDirectParticipantsKey(firstTechnicianId, secondTechnicianId) {
  const [smallerId, largerId] = [firstTechnicianId, secondTechnicianId].sort((left, right) => left - right);
  return `${smallerId}:${largerId}`;
}

export async function isParticipantOfConversation(conversationId, technicianId) {
  const rows = await queryDatabase(
    "SELECT 1 FROM main_app.participants_conversation WHERE conversation_id = $1 AND technician_id = $2",
    [conversationId, technicianId],
  );
  return rows.length > 0;
}

export async function findDirectConversationIdByKey(directParticipantsKey) {
  const [conversationRow] = await queryDatabase("SELECT id FROM main_app.conversations WHERE direct_participants_key = $1", [
    directParticipantsKey,
  ]);
  return conversationRow?.id ?? null;
}

/**
 * Crée la conversation directe et ses deux participants. ON CONFLICT : si
 * les deux personnes l'ouvrent au même moment, la seconde récupère la première.
 */
export async function insertDirectConversation(directParticipantsKey, participantTechnicianIds, databaseClient) {
  const [createdRow] = await queryDatabase(
    `INSERT INTO main_app.conversations (kind, direct_participants_key)
     VALUES ('direct', $1)
     ON CONFLICT (direct_participants_key) DO NOTHING
     RETURNING id`,
    [directParticipantsKey],
    databaseClient,
  );
  if (!createdRow) {
    return null;
  }
  await queryDatabase(
    `INSERT INTO main_app.participants_conversation (conversation_id, technician_id)
     SELECT $1, unnest($2::int[])`,
    [createdRow.id, participantTechnicianIds],
    databaseClient,
  );
  return createdRow.id;
}

/**
 * Conversations d'un technicien, la plus récente d'abord, avec l'autre
 * participant, un aperçu du dernier message et le nombre de messages non lus.
 */
export async function findConversationsByTechnicianId(technicianId) {
  const conversationRows = await queryDatabase(
    `SELECT conversations.id, conversations.kind, conversations.last_message_at, conversations.created_at,
            other_accounts.technician_id AS other_technician_id, other_accounts.username AS other_username,
            last_messages.kind AS last_message_kind, last_messages.text_content AS last_message_text,
            last_messages.sender_technician_id AS last_message_sender_id,
            (SELECT count(*)::int FROM main_app.messages AS unread_messages
              WHERE unread_messages.conversation_id = conversations.id
                AND unread_messages.id > own_participation.last_read_message_id
                AND unread_messages.sender_technician_id <> $1) AS unread_message_count
       FROM main_app.participants_conversation AS own_participation
       JOIN main_app.conversations AS conversations ON conversations.id = own_participation.conversation_id
       LEFT JOIN main_app.participants_conversation AS other_participation
              ON other_participation.conversation_id = conversations.id AND other_participation.technician_id <> $1
       LEFT JOIN main_app.comptes AS other_accounts ON other_accounts.technician_id = other_participation.technician_id
       LEFT JOIN LATERAL (
            SELECT kind, text_content, sender_technician_id FROM main_app.messages
             WHERE messages.conversation_id = conversations.id
             ORDER BY id DESC LIMIT 1) AS last_messages ON TRUE
      WHERE own_participation.technician_id = $1
      ORDER BY COALESCE(conversations.last_message_at, conversations.created_at) DESC
      LIMIT 200`,
    [technicianId],
  );
  return conversationRows.map((conversationRow) => ({
    id: conversationRow.id,
    kind: conversationRow.kind,
    otherParticipant: conversationRow.other_technician_id
      ? { technicianId: conversationRow.other_technician_id, username: conversationRow.other_username }
      : null,
    lastMessage: conversationRow.last_message_kind
      ? {
          kind: conversationRow.last_message_kind,
          // Aperçu en texte brut, tronqué : affiché avec textContent comme le reste.
          textPreview: [...conversationRow.last_message_text].slice(0, 80).join(""),
          isOwnMessage: conversationRow.last_message_sender_id === technicianId,
        }
      : null,
    lastMessageAt: conversationRow.last_message_at,
    unreadMessageCount: conversationRow.unread_message_count,
  }));
}

export async function touchConversationLastMessageAt(conversationId, databaseClient) {
  await queryDatabase("UPDATE main_app.conversations SET last_message_at = now() WHERE id = $1", [conversationId], databaseClient);
}

/** Le compteur ne recule jamais : un vieil accusé de lecture n'efface pas un plus récent. */
export async function updateLastReadMessageId(conversationId, technicianId, lastReadMessageId) {
  const rows = await queryDatabase(
    `UPDATE main_app.participants_conversation
        SET last_read_message_id = GREATEST(last_read_message_id, $3)
      WHERE conversation_id = $1 AND technician_id = $2
        AND EXISTS (SELECT 1 FROM main_app.messages WHERE id = $3 AND conversation_id = $1)
      RETURNING conversation_id`,
    [conversationId, technicianId, lastReadMessageId],
  );
  return rows.length > 0;
}

/** État léger, sans contenu de message ni limite de conversations, réservé au participant. */
export async function findNotificationState(technicianId) {
  const rows = await queryDatabase(
    `SELECT participation.conversation_id,
            count(messages.id) FILTER (WHERE messages.id > participation.last_read_message_id)::int AS unread_count,
            COALESCE(max(messages.id), 0) AS latest_incoming_message_id
       FROM main_app.participants_conversation AS participation
       LEFT JOIN main_app.messages AS messages
         ON messages.conversation_id = participation.conversation_id AND messages.sender_technician_id <> $1
      WHERE participation.technician_id = $1
      GROUP BY participation.conversation_id, participation.last_read_message_id`,
    [technicianId],
  );
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    unreadCount: row.unread_count,
    latestIncomingMessageId: row.latest_incoming_message_id,
  }));
}

/** Comptes actifs auxquels on peut écrire (recherche par nom), sauf soi-même. */
export async function findMessagingContacts(technicianId, searchText) {
  const contactRows = await queryDatabase(
    `SELECT technician_id, username FROM main_app.comptes
      WHERE is_active AND technician_id <> $1
        AND ($2 = '' OR username ILIKE '%' || $3 || '%')
      ORDER BY username
      LIMIT 50`,
    // $3 : le texte cherché avec % et _ échappés, pour qu'ils soient pris littéralement.
    [technicianId, searchText, searchText.replace(/[\\%_]/g, (character) => `\\${character}`)],
  );
  return contactRows.map((contactRow) => ({ technicianId: contactRow.technician_id, username: contactRow.username }));
}

export async function activeAccountExists(technicianId) {
  const rows = await queryDatabase("SELECT 1 FROM main_app.comptes WHERE technician_id = $1 AND is_active", [technicianId]);
  return rows.length > 0;
}
