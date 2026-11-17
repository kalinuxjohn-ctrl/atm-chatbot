/**
 * Prévient l'utilisateur d'un appel entrant, sur TOUTE page connectée.
 *
 * Ouvre le WebSocket de signalisation des appels (/api/calls/ws) et affiche
 * un bandeau « Appel de X — Répondre / Refuser ». Répondre ouvre la page
 * Appels, qui prend le relais : le serveur garde l'appel en sonnerie pendant
 * le changement de page (30 s au plus) et le renvoie à la nouvelle connexion.
 *
 * Si le conteneur des appels est arrêté, la connexion échoue en silence et
 * est retentée de plus en plus espacée : les autres pages fonctionnent.
 */

import { createAvatar, createButton, createElementWithText } from "./domHelpers.js";
import { createIcon } from "./icons.js";

const MAXIMUM_RECONNECT_DELAY_MILLISECONDS = 60_000;

export function startIncomingCallListener() {
  let reconnectDelayMilliseconds = 2_000;
  let currentBanner = null;
  let signalingSocket = null;

  function connect() {
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
      if (signalingMessage.type === "call.incoming") {
        showIncomingCallBanner(signalingMessage);
      }
      if (["call.ended", "call.taken-elsewhere"].includes(signalingMessage.type)) {
        removeBannerOfCall(signalingMessage.callId);
      }
    });
    signalingSocket.addEventListener("close", (closeEvent) => {
      // 4401 : session refusée par le serveur. Inutile de réessayer en boucle.
      if (closeEvent.code === 4401) {
        return;
      }
      setTimeout(connect, reconnectDelayMilliseconds);
      reconnectDelayMilliseconds = Math.min(reconnectDelayMilliseconds * 2, MAXIMUM_RECONNECT_DELAY_MILLISECONDS);
    });
  }

  function showIncomingCallBanner({ callId, caller }) {
    removeBannerOfCall(currentBanner?.dataset.callId);
    const banner = createElementWithText("div", "incoming-call-banner");
    banner.dataset.callId = callId;
    banner.setAttribute("role", "alertdialog");
    banner.setAttribute("aria-label", "Appel entrant");
    // Nom saisi par un utilisateur : textContent (createElementWithText), jamais innerHTML.
    const bannerText = createElementWithText("span", "incoming-call-banner-text");
    bannerText.append(createAvatar(caller.username), createElementWithText("span", "", `Appel de ${caller.username}`), createIcon("phone"));
    banner.append(
      bannerText,
      createButton("Répondre", {
        onClick: () => window.location.assign(`/calls/?incomingCallId=${encodeURIComponent(callId)}`),
      }),
      createButton("Refuser", {
        className: "button button-danger",
        onClick: () => {
          signalingSocket?.send(JSON.stringify({ type: "call.decline", callId }));
          removeBannerOfCall(callId);
        },
      }),
    );
    document.body.append(banner);
    currentBanner = banner;
  }

  function removeBannerOfCall(callId) {
    if (currentBanner && currentBanner.dataset.callId === callId) {
      currentBanner.remove();
      currentBanner = null;
    }
  }

  connect();
}
