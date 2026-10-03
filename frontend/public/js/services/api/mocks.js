/**
 * Réponses SIMULÉES, regroupées ici pour être faciles à retrouver puis à
 * supprimer. Chaque mock respecte le format de l'API réelle (ou future) :
 * l'interface ne voit aucune différence.
 */

const MOCK_REPLIES = [
  "Je vous recommande de vérifier le lecteur de carte.",
  "Commencez par contrôler le mécanisme de rétention de carte, puis relancez une transaction de test.",
  "Si le problème persiste, réinitialisez le lecteur de carte et notez le résultat dans l’intervention.",
];

let nextMockConversationId = 1;
let mockReplyIndex = 0;

function simulateLatency(minMs = 600, maxMs = 1200) {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Même format que POST /chat : { conversation_id, reply }. */
export async function mockChatResponse({ conversationId }) {
  await simulateLatency();
  const reply = MOCK_REPLIES[mockReplyIndex % MOCK_REPLIES.length];
  mockReplyIndex += 1;
  return { conversation_id: conversationId ?? nextMockConversationId++, reply };
}

/** Format prévu pour une future API vocale : { text, audio }. */
export async function mockVoiceResponse({ conversationId }) {
  const chat = await mockChatResponse({ conversationId });
  return { conversation_id: chat.conversation_id, text: chat.reply, audio: null };
}

/** Format prévu pour une future API d'authentification. */
export async function mockLoginResponse({ technicianId, displayName }) {
  await simulateLatency(300, 600);
  return { technician_id: technicianId, display_name: displayName };
}
