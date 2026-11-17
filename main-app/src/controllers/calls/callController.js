/**
 * Routes HTTP des appels (la signalisation, elle, passe par le WebSocket).
 */

import { parseWithSchema } from "../../core/validation.js";
import { callHistoryQuerySchema } from "../../schemas/calls/callSchemas.js";
import { listCallContactsWithPresence, listCallHistory } from "../../services/calls/callDirectoryService.js";

/**
 * Serveurs STUN/TURN que le navigateur utilise pour établir la liaison audio.
 * Si un TURN avec identifiants est configuré, ses identifiants partent forcément
 * au navigateur (c'est lui qui s'y connecte) : utiliser des identifiants à durée
 * limitée le jour où un TURN est ajouté (voir docs/main-app.md).
 */
export function readCallSettings(request, response) {
  response.json({ iceServers: request.app.locals.configuration.MAIN_APP_ICE_SERVERS });
}

export async function listContacts(request, response) {
  response.json({ contacts: await listCallContactsWithPresence(request.user, request.app.locals.callSignalingCoordinator) });
}

export async function listHistory(request, response) {
  const { limit } = parseWithSchema(callHistoryQuerySchema, request.query);
  response.json({ calls: await listCallHistory(request.user, limit) });
}
