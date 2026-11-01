/**
 * Signalisation des appels vocaux : qui appelle qui, sonnerie, décroché,
 * raccroché, et relais des messages WebRTC (offre, réponse, candidats ICE)
 * entre LES DEUX participants d'un appel, et eux seuls.
 *
 * Le son ne passe jamais ici : une fois la signalisation faite, les deux
 * navigateurs échangent l'audio directement (WebRTC pair-à-pair).
 *
 * Ce service ne connaît ni HTTP ni la librairie ws : il reçoit des
 * « connexions » { technicianId, username, sendMessage(message) } et des
 * messages déjà validés. Les dépendances (base, horloge) sont injectées,
 * ce qui le rend testable sans réseau.
 *
 * Règles :
 * - un seul appel en cours par utilisateur (sinon « occupé ») ;
 * - sonnerie de 30 s maximum, puis « manqué » ;
 * - seul l'appelé répond ou refuse ; seuls les deux participants signalent ;
 * - l'état est en mémoire : un redémarrage du conteneur coupe les appels en
 *   cours (le journal garde ceux déjà terminés). Un seul conteneur calls.
 */

import { randomUUID } from "node:crypto";

import { trace } from "../../core/tracing.js";

export const RING_TIMEOUT_MILLISECONDS = 30_000;

export function createCallSignalingCoordinator({
  findCallableAccount,
  recordCallLog,
  ringTimeoutMilliseconds = RING_TIMEOUT_MILLISECONDS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  getCurrentTime = () => new Date(),
}) {
  /** technicianId -> Set de connexions (un utilisateur peut avoir plusieurs onglets ouverts). */
  const connectionsByTechnicianId = new Map();
  const callsById = new Map();
  /** technicianId -> callId de son appel en cours (sonnerie ou conversation). */
  const callIdByTechnicianId = new Map();

  function sendToTechnician(technicianId, message) {
    for (const connection of connectionsByTechnicianId.get(technicianId) ?? []) {
      connection.sendMessage(message);
    }
  }

  function sendError(connection, errorCode, message) {
    connection.sendMessage({ type: "error", code: errorCode, message });
  }

  function findCallOfParticipant(connection, callId) {
    const call = callsById.get(callId);
    const isParticipant = call && [call.callerTechnicianId, call.calleeTechnicianId].includes(connection.technicianId);
    return isParticipant ? call : null;
  }

  /**
   * Termine l'appel : prévient les deux côtés, libère les participants, écrit
   * le journal. `status` est celui du journal (missed, answered, declined, failed).
   */
  function endCall(call, { status, endReason }) {
    if (!callsById.has(call.callId)) {
      return;
    }
    clearTimer(call.ringTimer);
    callsById.delete(call.callId);
    callIdByTechnicianId.delete(call.callerTechnicianId);
    callIdByTechnicianId.delete(call.calleeTechnicianId);

    const endedMessage = { type: "call.ended", callId: call.callId, reason: endReason };
    sendToTechnician(call.callerTechnicianId, endedMessage);
    sendToTechnician(call.calleeTechnicianId, endedMessage);
    trace("CALLS", "Appel terminé", { callId: call.callId, status, endReason });
    writeCallLog({ ...call, status, endReason, endedAt: getCurrentTime() });
  }

  function writeCallLog(callLog) {
    Promise.resolve(
      recordCallLog({
        callId: callLog.callId,
        callerTechnicianId: callLog.callerTechnicianId,
        calleeTechnicianId: callLog.calleeTechnicianId,
        status: callLog.status,
        endReason: callLog.endReason,
        startedAt: callLog.startedAt,
        answeredAt: callLog.answeredAt ?? null,
        endedAt: callLog.endedAt,
      }),
    ).catch((error) => trace("ERROR", "Journal d'appel non enregistré", { errorMessage: error.message }));
  }

  /** Appel impossible avant même de sonner (occupé, hors ligne) : journalisé comme échec. */
  function refuseCallBeforeRinging(connection, callee, endReason) {
    const now = getCurrentTime();
    const callId = randomUUID();
    connection.sendMessage({ type: "call.ended", callId, reason: endReason, callee });
    writeCallLog({
      callId,
      callerTechnicianId: connection.technicianId,
      calleeTechnicianId: callee.technicianId,
      status: "failed",
      endReason,
      startedAt: now,
      endedAt: now,
    });
  }

  async function startCall(connection, { calleeTechnicianId }) {
    if (calleeTechnicianId === connection.technicianId) {
      sendError(connection, "invalid_callee", "Impossible de s'appeler soi-même.");
      return;
    }
    if (callIdByTechnicianId.has(connection.technicianId)) {
      sendError(connection, "already_in_call", "Vous êtes déjà en appel.");
      return;
    }
    const callee = await findCallableAccount(calleeTechnicianId);
    if (!callee) {
      sendError(connection, "callee_not_found", "Destinataire introuvable.");
      return;
    }
    // Revérifié après l'accès à la base : un autre appel a pu commencer entre-temps.
    if (callIdByTechnicianId.has(connection.technicianId)) {
      sendError(connection, "already_in_call", "Vous êtes déjà en appel.");
      return;
    }
    if (callIdByTechnicianId.has(callee.technicianId)) {
      refuseCallBeforeRinging(connection, callee, "busy");
      return;
    }
    if (!connectionsByTechnicianId.has(callee.technicianId)) {
      refuseCallBeforeRinging(connection, callee, "callee_offline");
      return;
    }

    const call = {
      callId: randomUUID(),
      callerTechnicianId: connection.technicianId,
      callerUsername: connection.username,
      calleeTechnicianId: callee.technicianId,
      calleeUsername: callee.username,
      callerConnection: connection,
      calleeConnection: null, // l'onglet qui décroche
      state: "ringing",
      startedAt: getCurrentTime(),
      answeredAt: null,
      ringTimer: null,
    };
    callsById.set(call.callId, call);
    callIdByTechnicianId.set(call.callerTechnicianId, call.callId);
    callIdByTechnicianId.set(call.calleeTechnicianId, call.callId);
    call.ringTimer = setTimer(() => endCall(call, { status: "missed", endReason: "no_answer" }), ringTimeoutMilliseconds);

    connection.sendMessage({
      type: "call.ringing",
      callId: call.callId,
      callee: { technicianId: callee.technicianId, username: callee.username },
    });
    sendToTechnician(callee.technicianId, createIncomingCallMessage(call));
    trace("CALLS", "Appel lancé", { callId: call.callId });
  }

  function createIncomingCallMessage(call) {
    return {
      type: "call.incoming",
      callId: call.callId,
      caller: { technicianId: call.callerTechnicianId, username: call.callerUsername },
    };
  }

  function acceptCall(connection, { callId }) {
    const call = findCallOfParticipant(connection, callId);
    if (!call || call.state !== "ringing" || connection.technicianId !== call.calleeTechnicianId) {
      sendError(connection, "cannot_accept", "Cet appel ne peut pas être accepté.");
      return;
    }
    clearTimer(call.ringTimer);
    call.state = "active";
    call.answeredAt = getCurrentTime();
    call.calleeConnection = connection;
    call.callerConnection.sendMessage({ type: "call.accepted", callId });
    // Les autres onglets de l'appelé arrêtent de sonner.
    for (const otherConnection of connectionsByTechnicianId.get(call.calleeTechnicianId) ?? []) {
      if (otherConnection !== connection) {
        otherConnection.sendMessage({ type: "call.taken-elsewhere", callId });
      }
    }
  }

  function declineCall(connection, { callId }) {
    const call = findCallOfParticipant(connection, callId);
    if (!call || call.state !== "ringing" || connection.technicianId !== call.calleeTechnicianId) {
      sendError(connection, "cannot_decline", "Cet appel ne peut pas être refusé.");
      return;
    }
    endCall(call, { status: "declined", endReason: "declined" });
  }

  function hangUpCall(connection, { callId }) {
    const call = findCallOfParticipant(connection, callId);
    if (!call) {
      return; // déjà terminé : rien à faire
    }
    if (call.state === "ringing") {
      // Seul l'appelant raccroche pendant la sonnerie ; l'appelé, lui, refuse.
      if (connection.technicianId === call.callerTechnicianId) {
        endCall(call, { status: "missed", endReason: "caller_cancelled" });
      } else {
        endCall(call, { status: "declined", endReason: "declined" });
      }
      return;
    }
    endCall(call, { status: "answered", endReason: "hung_up" });
  }

  /**
   * Relais WebRTC : uniquement pendant un appel décroché, uniquement depuis
   * l'un des deux onglets engagés, et uniquement vers l'autre.
   */
  function relaySignalingMessage(connection, message) {
    const call = findCallOfParticipant(connection, message.callId);
    if (!call || call.state !== "active") {
      sendError(connection, "no_active_call", "Aucun appel en cours avec cet identifiant.");
      return;
    }
    const recipientConnection =
      connection === call.callerConnection ? call.calleeConnection : connection === call.calleeConnection ? call.callerConnection : null;
    if (!recipientConnection) {
      sendError(connection, "not_call_connection", "Cet onglet ne participe pas à l'appel.");
      return;
    }
    const { type, callId, sessionDescription, iceCandidate } = message;
    recipientConnection.sendMessage({ type, callId, ...(sessionDescription ? { sessionDescription } : {}), ...(iceCandidate ? { iceCandidate } : {}) });
  }

  return {
    connectionOpened(connection) {
      if (!connectionsByTechnicianId.has(connection.technicianId)) {
        connectionsByTechnicianId.set(connection.technicianId, new Set());
      }
      connectionsByTechnicianId.get(connection.technicianId).add(connection);
      connection.sendMessage({ type: "connection.ready" });
      // Appel qui sonne pour cet utilisateur (il change de page pour répondre) : on le lui renvoie.
      const ringingCall = callsById.get(callIdByTechnicianId.get(connection.technicianId));
      if (ringingCall?.state === "ringing" && ringingCall.calleeTechnicianId === connection.technicianId) {
        connection.sendMessage(createIncomingCallMessage(ringingCall));
      }
    },

    connectionClosed(connection) {
      const technicianConnections = connectionsByTechnicianId.get(connection.technicianId);
      technicianConnections?.delete(connection);
      if (technicianConnections?.size === 0) {
        connectionsByTechnicianId.delete(connection.technicianId);
      }
      const call = callsById.get(callIdByTechnicianId.get(connection.technicianId));
      if (!call) {
        return;
      }
      if (connection === call.callerConnection) {
        endCall(call, call.state === "ringing" ? { status: "missed", endReason: "caller_cancelled" } : { status: "answered", endReason: "connection_lost" });
      } else if (connection === call.calleeConnection) {
        endCall(call, { status: "answered", endReason: "connection_lost" });
      }
      // Onglet de l'appelé fermé pendant la sonnerie : l'appel continue de sonner
      // (il ouvre peut-être la page Appels pour répondre). Le délai de 30 s s'applique.
    },

    async handleClientMessage(connection, message) {
      switch (message.type) {
        case "call.start":
          return startCall(connection, message);
        case "call.accept":
          return acceptCall(connection, message);
        case "call.decline":
          return declineCall(connection, message);
        case "call.hang-up":
          return hangUpCall(connection, message);
        default:
          return relaySignalingMessage(connection, message);
      }
    },

    isTechnicianOnline(technicianId) {
      return connectionsByTechnicianId.has(technicianId);
    },

    /** Arrêt du conteneur : chaque appel en cours est terminé et journalisé. */
    endAllCalls() {
      for (const call of [...callsById.values()]) {
        endCall(call, { status: call.state === "active" ? "answered" : "failed", endReason: "server_shutdown" });
      }
    },
  };
}
