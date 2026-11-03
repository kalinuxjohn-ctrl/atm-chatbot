/**
 * Page Administration : réunit l'administration de l'Espace techniciens
 * (comptes) et celle du Copilote (propositions, ajouts d'intervention,
 * codes d'erreur, pannes fréquentes).
 *
 * Ce fichier ne fait que l'aiguillage :
 *   - vérifie que l'utilisateur est administrateur (sinon message « réservé ») ;
 *   - affiche la rubrique demandée par l'adresse (#comptes, #propositions…) ;
 *   - remplit les compteurs du sommaire (demandes en attente, nombre d'éléments).
 * Chaque rubrique vit dans son propre module (*Section.js).
 *
 * Les droits sont vérifiés côté serveur : par le conteneur auth pour les
 * comptes, par le gateway (puis la clé du chatbot) pour le Copilote.
 */

import { currentUserPromise } from "/shared/js/connectedPageShell.js";
import { createAccountsSection } from "./accountsSection.js";
import { createInterventionAddsSection } from "./interventionAddsSection.js";
import { createErrorCodesSection, createUsualProblemsSection } from "./savedRepliesSection.js";
import { createSolutionProposalsSection } from "./solutionProposalsSection.js";

const DEFAULT_SECTION_NAME = "propositions";

/** Compteur à droite d'un lien du sommaire ; caché à 0 pour les demandes en attente. */
function showSectionCounter(sectionName, count, { hideWhenZero = false } = {}) {
  const counterElement = document.querySelector(`[data-section-counter="${sectionName}"]`);
  counterElement.textContent = String(count);
  counterElement.hidden = hideWhenZero && count === 0;
}

const currentUser = await currentUserPromise;

// auth indisponible (currentUser null) : on tente quand même, les API diront si l'accès est refusé.
if (currentUser && currentUser.role !== "admin") {
  document.querySelector("[data-administration-forbidden]").hidden = false;
} else {
  document.querySelector("[data-administration-workspace]").hidden = false;
  const reviewerName = currentUser?.fullName || currentUser?.username || "Administrateur";

  const sections = {
    comptes: createAccountsSection({ currentUser, showAccountCount: (count) => showSectionCounter("comptes", count) }),
    propositions: createSolutionProposalsSection({
      reviewerName,
      showPendingCount: (count) => showSectionCounter("propositions", count, { hideWhenZero: true }),
    }),
    interventions: createInterventionAddsSection({
      reviewerName,
      showPendingCount: (count) => showSectionCounter("interventions", count, { hideWhenZero: true }),
    }),
    "codes-erreur": createErrorCodesSection({ showRecordCount: (count) => showSectionCounter("codes-erreur", count) }),
    "pannes-frequentes": createUsualProblemsSection({ showRecordCount: (count) => showSectionCounter("pannes-frequentes", count) }),
  };

  /** Affiche la rubrique de l'adresse et la recharge (un autre admin a pu modifier la liste). */
  function openSectionFromAddress() {
    const requestedName = window.location.hash.slice(1);
    const sectionName = requestedName in sections ? requestedName : DEFAULT_SECTION_NAME;
    for (const sectionElement of document.querySelectorAll("[data-section]")) {
      sectionElement.hidden = sectionElement.dataset.section !== sectionName;
    }
    for (const menuLink of document.querySelectorAll("[data-section-link]")) {
      if (menuLink.dataset.sectionLink === sectionName) {
        menuLink.setAttribute("aria-current", "page");
      } else {
        menuLink.removeAttribute("aria-current");
      }
    }
    // Le navigateur saute jusqu'à l'élément #rubrique : on revient en haut de la page.
    window.scrollTo({ top: 0 });
    sections[sectionName].load();
  }

  window.addEventListener("hashchange", openSectionFromAddress);
  openSectionFromAddress();

  // Compteurs des demandes en attente, visibles quelle que soit la rubrique ouverte.
  sections.propositions.refreshPendingCount();
  sections.interventions.refreshPendingCount();
}
