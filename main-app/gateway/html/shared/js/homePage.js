/**
 * Accueil : salutation et trois chiffres du moment (messages non lus,
 * collègues connectés, lieux sur la carte).
 *
 * Chaque chiffre vient de l'API de sa fonctionnalité, indépendamment des
 * autres : si un conteneur est arrêté, sa case garde « – » et le reste s'affiche.
 */

import { requestJson } from "./apiClient.js";
import { currentUserPromise } from "./connectedPageShell.js";

// Zone du monde entier : l'API plafonne à 500 points par requête.
const WHOLE_WORLD_BOUNDING_BOX = new URLSearchParams({ south: "-90", west: "-180", north: "90", east: "180" });
const MAXIMUM_POINTS_PER_REQUEST = 500;

function greetingForCurrentHour() {
  const hour = new Date().getHours();
  return hour >= 18 || hour < 5 ? "Bonsoir" : "Bonjour";
}

function showSummaryValue(selector, value) {
  document.querySelector(selector).textContent = String(value);
}

const todayLabel = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
document.querySelector("[data-home-date]").textContent = todayLabel;

currentUserPromise.then((currentUser) => {
  const greeting = greetingForCurrentHour();
  document.querySelector("[data-home-greeting]").textContent = currentUser ? `${greeting}, ${currentUser.username}` : greeting;
});

requestJson("/api/messaging/conversations")
  .then(({ conversations }) => {
    const unreadMessageCount = conversations.reduce((total, conversation) => total + conversation.unreadMessageCount, 0);
    showSummaryValue("[data-unread-message-count]", unreadMessageCount);
  })
  .catch(() => {});

requestJson("/api/calls/contacts")
  .then(({ contacts }) => showSummaryValue("[data-online-colleague-count]", contacts.filter((contact) => contact.isOnline).length))
  .catch(() => {});

requestJson(`/api/map/points?${WHOLE_WORLD_BOUNDING_BOX}`)
  .then(({ points }) => {
    showSummaryValue("[data-map-point-count]", points.length >= MAXIMUM_POINTS_PER_REQUEST ? `${MAXIMUM_POINTS_PER_REQUEST}+` : points.length);
  })
  .catch(() => {});
