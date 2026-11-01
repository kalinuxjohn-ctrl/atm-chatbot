/**
 * Page Appels : appels vocaux 1 contre 1 en WebRTC.
 *
 * Le serveur ne fait que la SIGNALISATION, par WebSocket (/api/calls/ws) :
 * sonnerie, décroché, puis échange des offres SDP et des candidats ICE.
 * Le son va directement d'un navigateur à l'autre et n'est jamais enregistré.
 *
 * Déroulé :
 *   appelant : micro -> call.start -> (call.ringing) -> call.accepted -> offre -> réponse
 *   appelé   : call.incoming -> Répondre : micro -> call.accept -> offre reçue -> réponse envoyée
 */

import { requestJson } from "/shared/js/apiClient.js";
import "/shared/js/connectedPageShell.js";
import { createButton, createElementWithText, formatDateTime } from "/shared/js/domHelpers.js";

const END_REASON_LABELS = {
  declined: "Appel refusé.",
  no_answer: "Pas de réponse.",
  caller_cancelled: "Appel annulé.",
  hung_up: "Appel terminé.",
  busy: "Votre correspondant est déjà en ligne (occupé).",
  callee_offline: "Votre correspondant n'est pas connecté.",
  connection_lost: "Connexion perdue.",
  server_shutdown: "Service d'appel redémarré.",
};
const CALL_STATUS_LABELS = { missed: "manqué", answered: "décroché", declined: "refusé", failed: "échoué" };

const callPanel = document.querySelector("[data-call-panel]");
const callPanelTitle = document.querySelector("[data-call-panel-title]");
const callPanelStatus = document.querySelector("[data-call-panel-status]");
const acceptButton = document.querySelector("[data-accept-call]");
const declineButton = document.querySelector("[data-decline-call]");
const muteButton = document.querySelector("[data-toggle-mute]");
const hangUpButton = document.querySelector("[data-hang-up]");
const remoteAudio = document.querySelector("[data-remote-audio]");
const callsError = document.querySelector("[data-calls-error]");
const signalingStatus = document.querySelector("[data-signaling-status]");
const contactList = document.querySelector("[data-call-contact-list]");
const historyList = document.querySelector("[data-call-history-list]");

let iceServers = [];
let signalingSocket = null;
let reconnectDelayMilliseconds = 2_000;
/** Appel en cours : { callId, role: "caller"|"callee", otherUsername, peerConnection, microphoneStream, pendingIceCandidates } */
let currentCall = null;

function showError(message) {
  callsError.textContent = message;
  callsError.hidden = !message;
}

function sendSignalingMessage(message) {
  if (signalingSocket?.readyState === WebSocket.OPEN) {
    signalingSocket.send(JSON.stringify(message));
  }
}

// --- Affichage du panneau d'appel ----------------------------------------------

function showCallPanel({ title, status, buttons }) {
  callPanel.hidden = false;
  callPanelTitle.textContent = title;
  callPanelStatus.textContent = status;
  acceptButton.hidden = !buttons.includes("accept");
  declineButton.hidden = !buttons.includes("decline");
  muteButton.hidden = !buttons.includes("mute");
  hangUpButton.hidden = !buttons.includes("hangUp");
}

function hideCallPanelSoon(finalStatus) {
  showCallPanel({ title: callPanelTitle.textContent, status: finalStatus, buttons: [] });
  setTimeout(() => {
    if (!currentCall) {
      callPanel.hidden = true;
    }
  }, 4_000);
}

// --- WebRTC ------------------------------------------------------------------

async function openMicrophone() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    showError("Micro inaccessible : autorisez le micro pour ce site.");
    return null;
  }
}

function createPeerConnection(call) {
  const peerConnection = new RTCPeerConnection({ iceServers });
  for (const audioTrack of call.microphoneStream.getAudioTracks()) {
    peerConnection.addTrack(audioTrack, call.microphoneStream);
  }
  peerConnection.addEventListener("icecandidate", ({ candidate }) => {
    if (candidate) {
      sendSignalingMessage({ type: "call.ice-candidate", callId: call.callId, iceCandidate: candidate.toJSON() });
    }
  });
  peerConnection.addEventListener("track", ({ streams }) => {
    remoteAudio.srcObject = streams[0];
    remoteAudio.play().catch(() => {});
  });
  peerConnection.addEventListener("connectionstatechange", () => {
    if (peerConnection.connectionState === "connected") {
      showCallPanel({ title: `En ligne avec ${call.otherUsername}`, status: "Communication établie.", buttons: ["mute", "hangUp"] });
    }
    if (peerConnection.connectionState === "failed") {
      // Souvent un réseau qui bloque le pair-à-pair : un serveur TURN serait nécessaire.
      showError("Liaison audio impossible avec ce réseau. Réessayez sur un autre réseau (Wi-Fi / 4G).");
      hangUp();
    }
  });
  return peerConnection;
}

/** Les candidats ICE peuvent arriver avant la description distante : ils attendent dans une file. */
async function addRemoteIceCandidate(iceCandidate) {
  if (!currentCall?.peerConnection?.remoteDescription) {
    currentCall?.pendingIceCandidates.push(iceCandidate);
    return;
  }
  await currentCall.peerConnection.addIceCandidate(iceCandidate).catch(() => {});
}

async function applyPendingIceCandidates() {
  for (const iceCandidate of currentCall.pendingIceCandidates.splice(0)) {
    await currentCall.peerConnection.addIceCandidate(iceCandidate).catch(() => {});
  }
}

function releaseCallResources() {
  currentCall?.peerConnection?.close();
  currentCall?.microphoneStream?.getTracks().forEach((track) => track.stop());
  remoteAudio.srcObject = null;
  currentCall = null;
  muteButton.setAttribute("aria-pressed", "false");
  muteButton.textContent = "Couper le micro";
}

// --- Actions de l'utilisateur ---------------------------------------------------

async function callColleague(contact) {
  if (currentCall) {
    showError("Un appel est déjà en cours.");
    return;
  }
  showError("");
  const microphoneStream = await openMicrophone();
  if (!microphoneStream) {
    return;
  }
  currentCall = { callId: null, role: "caller", otherUsername: contact.username, microphoneStream, peerConnection: null, pendingIceCandidates: [] };
  showCallPanel({ title: `Appel vers ${contact.username}`, status: "Connexion…", buttons: ["hangUp"] });
  sendSignalingMessage({ type: "call.start", calleeTechnicianId: contact.technicianId });
}

async function acceptIncomingCall() {
  const microphoneStream = await openMicrophone();
  if (!microphoneStream || !currentCall) {
    declineIncomingCall();
    return;
  }
  currentCall.microphoneStream = microphoneStream;
  currentCall.peerConnection = createPeerConnection(currentCall);
  showCallPanel({ title: `Appel de ${currentCall.otherUsername}`, status: "Connexion audio…", buttons: ["mute", "hangUp"] });
  sendSignalingMessage({ type: "call.accept", callId: currentCall.callId });
}

function declineIncomingCall() {
  if (currentCall) {
    sendSignalingMessage({ type: "call.decline", callId: currentCall.callId });
  }
  releaseCallResources();
  callPanel.hidden = true;
}

function hangUp() {
  if (currentCall?.callId) {
    sendSignalingMessage({ type: "call.hang-up", callId: currentCall.callId });
  }
  releaseCallResources();
  hideCallPanelSoon("Appel terminé.");
}

function toggleMicrophoneMute() {
  const audioTracks = currentCall?.microphoneStream?.getAudioTracks() ?? [];
  const willBeMuted = audioTracks.some((track) => track.enabled);
  audioTracks.forEach((track) => {
    track.enabled = !willBeMuted;
  });
  muteButton.setAttribute("aria-pressed", String(willBeMuted));
  muteButton.textContent = willBeMuted ? "Réactiver le micro" : "Couper le micro";
}

acceptButton.addEventListener("click", acceptIncomingCall);
declineButton.addEventListener("click", declineIncomingCall);
hangUpButton.addEventListener("click", hangUp);
muteButton.addEventListener("click", toggleMicrophoneMute);

// --- Messages reçus du serveur de signalisation -----------------------------------

const signalingMessageHandlers = {
  "connection.ready": () => {
    signalingStatus.hidden = true;
    reloadContacts();
  },

  "call.ringing": ({ callId, callee }) => {
    if (currentCall?.role === "caller" && !currentCall.callId) {
      currentCall.callId = callId;
      showCallPanel({ title: `Appel vers ${callee.username}`, status: "Ça sonne…", buttons: ["hangUp"] });
    }
  },

  "call.incoming": ({ callId, caller }) => {
    if (currentCall && currentCall.callId !== callId) {
      // Déjà en ligne : le serveur a déjà répondu « occupé » ; rien à afficher ici.
      return;
    }
    currentCall = { callId, role: "callee", otherUsername: caller.username, microphoneStream: null, peerConnection: null, pendingIceCandidates: [] };
    showCallPanel({ title: `Appel de ${caller.username}`, status: "📞 Appel entrant…", buttons: ["accept", "decline"] });
  },

  "call.accepted": async ({ callId }) => {
    if (currentCall?.callId !== callId || currentCall.role !== "caller") {
      return;
    }
    showCallPanel({ title: `Appel vers ${currentCall.otherUsername}`, status: "Connexion audio…", buttons: ["mute", "hangUp"] });
    currentCall.peerConnection = createPeerConnection(currentCall);
    const offer = await currentCall.peerConnection.createOffer({ offerToReceiveAudio: true });
    await currentCall.peerConnection.setLocalDescription(offer);
    sendSignalingMessage({ type: "call.offer", callId, sessionDescription: { type: offer.type, sdp: offer.sdp } });
  },

  "call.offer": async ({ callId, sessionDescription }) => {
    if (currentCall?.callId !== callId || !currentCall.peerConnection) {
      return;
    }
    await currentCall.peerConnection.setRemoteDescription(sessionDescription);
    await applyPendingIceCandidates();
    const answer = await currentCall.peerConnection.createAnswer();
    await currentCall.peerConnection.setLocalDescription(answer);
    sendSignalingMessage({ type: "call.answer", callId, sessionDescription: { type: answer.type, sdp: answer.sdp } });
  },

  "call.answer": async ({ callId, sessionDescription }) => {
    if (currentCall?.callId !== callId || !currentCall.peerConnection) {
      return;
    }
    await currentCall.peerConnection.setRemoteDescription(sessionDescription);
    await applyPendingIceCandidates();
  },

  "call.ice-candidate": ({ callId, iceCandidate }) => {
    if (currentCall?.callId === callId) {
      addRemoteIceCandidate(iceCandidate);
    }
  },

  "call.taken-elsewhere": ({ callId }) => {
    if (currentCall?.callId === callId && !currentCall.peerConnection) {
      releaseCallResources();
      hideCallPanelSoon("Appel pris sur un autre appareil.");
    }
  },

  "call.ended": ({ callId, reason }) => {
    // callId inconnu côté appelant : l'appel a été refusé avant de sonner (occupé, hors ligne).
    const concernsCurrentCall = currentCall && (currentCall.callId === callId || (currentCall.role === "caller" && !currentCall.callId));
    if (concernsCurrentCall) {
      releaseCallResources();
      hideCallPanelSoon(END_REASON_LABELS[reason] ?? "Appel terminé.");
    }
    reloadHistory();
  },

  error: ({ message }) => {
    showError(message);
    if (currentCall?.role === "caller" && !currentCall.callId) {
      releaseCallResources();
      callPanel.hidden = true;
    }
  },
};

function connectToSignalingServer() {
  const websocketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  signalingSocket = new WebSocket(`${websocketProtocol}//${window.location.host}/api/calls/ws`);
  signalingSocket.addEventListener("open", () => {
    reconnectDelayMilliseconds = 2_000;
  });
  signalingSocket.addEventListener("message", (messageEvent) => {
    let signalingMessage;
    try {
      signalingMessage = JSON.parse(messageEvent.data);
    } catch {
      return;
    }
    signalingMessageHandlers[signalingMessage.type]?.(signalingMessage);
  });
  signalingSocket.addEventListener("close", () => {
    if (currentCall) {
      releaseCallResources();
      hideCallPanelSoon("Connexion au service d'appel perdue.");
    }
    signalingStatus.textContent = "Service d'appel indisponible : nouvelle tentative de connexion…";
    signalingStatus.hidden = false;
    setTimeout(connectToSignalingServer, reconnectDelayMilliseconds);
    reconnectDelayMilliseconds = Math.min(reconnectDelayMilliseconds * 2, 30_000);
  });
}

// --- Collègues et historique --------------------------------------------------

async function reloadContacts() {
  try {
    const { contacts } = await requestJson("/api/calls/contacts");
    contactList.replaceChildren(
      ...contacts.map((contact) => {
        const listItem = createElementWithText("li", "call-contact-item");
        const presenceIndicator = createElementWithText("span", contact.isOnline ? "presence-indicator presence-indicator-online" : "presence-indicator");
        presenceIndicator.title = contact.isOnline ? "Connecté" : "Hors ligne";
        const callButton = createButton("Appeler", { onClick: () => callColleague(contact) });
        callButton.disabled = !contact.isOnline;
        listItem.append(presenceIndicator, createElementWithText("span", "call-contact-name", contact.username), callButton);
        return listItem;
      }),
    );
    if (contacts.length === 0) {
      contactList.replaceChildren(createElementWithText("li", "muted", "Aucun autre compte pour le moment."));
    }
  } catch (error) {
    showError(error.message);
  }
}

function formatCallDuration(call) {
  if (!call.answeredAt) {
    return "";
  }
  const durationSeconds = Math.round((new Date(call.endedAt) - new Date(call.answeredAt)) / 1000);
  return ` · ${Math.floor(durationSeconds / 60)} min ${String(durationSeconds % 60).padStart(2, "0")} s`;
}

async function reloadHistory() {
  try {
    const { calls } = await requestJson("/api/calls/history");
    historyList.replaceChildren(
      ...calls.map((call) => {
        const listItem = createElementWithText("li", "call-history-item");
        const otherUsername = call.otherParticipant?.username ?? "ancien utilisateur";
        listItem.append(
          createElementWithText("span", "call-history-direction", call.isOutgoing ? "↗" : "↙"),
          createElementWithText(
            "span",
            `call-history-text call-history-status-${call.status}`,
            `${otherUsername} · ${CALL_STATUS_LABELS[call.status] ?? call.status} · ${formatDateTime(call.startedAt)}${formatCallDuration(call)}`,
          ),
        );
        return listItem;
      }),
    );
    if (calls.length === 0) {
      historyList.replaceChildren(createElementWithText("li", "muted", "Aucun appel pour le moment."));
    }
  } catch (error) {
    showError(error.message);
  }
}

try {
  ({ iceServers } = await requestJson("/api/calls/settings"));
} catch (error) {
  showError(`Service d'appel indisponible : ${error.message}`);
}
connectToSignalingServer();
reloadHistory();
// Présence des collègues rafraîchie régulièrement (qui vient de se connecter).
setInterval(() => {
  if (!document.hidden) {
    reloadContacts();
  }
}, 15_000);
