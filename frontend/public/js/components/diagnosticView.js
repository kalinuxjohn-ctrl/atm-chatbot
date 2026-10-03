/**
 * Affichage de la page Diagnostic (recherche de symptôme) : messages,
 * résumé, symptômes, cartes d'actions, erreurs. Aucun appel réseau ici.
 * (Anciennement js/ui.js, comportement inchangé.)
 */

import { createElement, formatTime } from "../utils/dom.js";

/* ---------- Briques de message ---------- */

function createAssistantMessage(time) {
  const message = createElement("article", "message assistant-message assistant-response");
  const avatar = createElement("span", "message-avatar", "A");
  avatar.setAttribute("aria-hidden", "true");
  const body = createElement("div", "message-body");
  const author = createElement("span", "message-author");
  author.append(document.createTextNode("ATM Assistant "), createElement("time", "", time));
  body.append(author);
  message.append(avatar, body);
  return { message, body };
}

function appendRetryButton(container, onRetry, label = "Réessayer") {
  const retryButton = createElement("button", "retry-button", label);
  retryButton.type = "button";
  retryButton.addEventListener("click", onRetry, { once: true });
  container.append(retryButton);
}

/* ---------- Résultat de recherche ---------- */

/** Libellé de chaque symptôme retrouvé (texte si fourni, sinon identifiant). */
function getSymptomLabels(result) {
  const symptomsById = new Map(
    result.solutions
      .filter((solution) => solution.symptomId !== null && solution.symptomText)
      .map((solution) => [solution.symptomId, solution.symptomText]),
  );
  return result.matchedSymptomIds.map((symptomId) => symptomsById.get(symptomId) || `Symptôme #${symptomId}`);
}

function createSolutionCard(solution, index) {
  const card = createElement("article", "solution-card");
  const number = createElement("span", "solution-index", String(index + 1).padStart(2, "0"));
  number.setAttribute("aria-hidden", "true");
  const content = createElement("div", "solution-copy");
  content.append(createElement("strong", "", solution.actionText || "Libellé de l’action non fourni par l’API."));

  if (solution.actionId !== null && !solution.actionText) {
    content.append(createElement("span", "action-id-note", `Identifiant de l’action : #${solution.actionId}`));
  }
  if (solution.symptomText) {
    content.append(createElement("span", "solution-symptom", `Symptôme associé : ${solution.symptomText}`));
  }

  // On n'affiche que les statistiques réellement fournies par l'API.
  const statistics = [];
  if (solution.accuracy !== null && solution.accuracy >= 0 && solution.accuracy <= 1) {
    statistics.push(createElement("span", "accuracy-value", `Réussite : ${Math.round(solution.accuracy * 100)} %`));
  }
  if (solution.successes !== null && solution.attempts !== null) {
    statistics.push(createElement("span", "", `${solution.successes} réussite(s) sur ${solution.attempts} tentative(s)`));
  }
  if (statistics.length > 0) {
    const stats = createElement("span", "solution-stats");
    statistics.forEach((statistic, statisticIndex) => {
      if (statisticIndex > 0) stats.append(createElement("span", "", "·"));
      stats.append(statistic);
    });
    content.append(stats);
  }

  card.append(number, content);
  return card;
}

function renderSearchResult(body, result, onRetry) {
  if (result.summaryUnavailable) {
    body.append(createElement(
      "p",
      "summary-warning",
      "Le résumé automatique est temporairement indisponible. Les informations de l’historique restent affichées ci-dessous.",
    ));
  } else if (result.summary) {
    const summaryCard = createElement("section", "summary-card");
    summaryCard.setAttribute("aria-label", "Résumé de la recherche");
    summaryCard.append(createElement("h3", "", "Résumé"), createElement("p", "", result.summary));
    body.append(summaryCard);
  }

  const symptomLabels = getSymptomLabels(result);
  if (symptomLabels.length > 0) {
    body.append(createElement("h3", "identified-heading", "Symptômes associés"));
    const badges = createElement("div", "identified-symptoms");
    symptomLabels.forEach((label) => badges.append(createElement("span", "symptom-badge", label)));
    body.append(badges);
  }

  if (result.solutions.length > 0) {
    const heading = createElement("h3", "solutions-heading", "Actions documentées");
    heading.append(createElement("span", "", `${result.solutions.length} résultat${result.solutions.length === 1 ? "" : "s"}`));
    body.append(heading);
    const solutionList = createElement("div", "solution-list");
    solutionList.setAttribute("aria-label", "Actions documentées, classées par taux de réussite");
    result.solutions.forEach((solution, index) => solutionList.append(createSolutionCard(solution, index)));
    body.append(solutionList);
    body.append(createElement(
      "p",
      "response-intro",
      "Ces actions proviennent de l’historique enregistré et ne garantissent pas la résolution du problème.",
    ));
    return;
  }

  const noResults = createElement("div", "no-results-card");
  noResults.append(
    createElement("strong", "", "Nous n’avons pas trouvé de solution exacte."),
    createElement("span", "", "Essayez de décrire votre problème autrement, ou relancez cette recherche."),
  );
  body.append(noResults);
  appendRetryButton(body, onRetry);
}

/* ---------- API publique de la vue ---------- */

export function appendUserMessage(conversation, text, deviceType, time) {
  const message = createElement("article", "message user-message");
  const body = createElement("div", "message-body");
  const author = createElement("span", "message-author");
  author.append(document.createTextNode("Vous "), createElement("time", "", time));
  const bubble = createElement("div", "message-bubble");
  bubble.append(
    createElement("p", "", text),
    createElement("span", "solution-symptom", `Équipement : ${deviceType.toUpperCase()}`),
  );
  body.append(author, bubble);
  message.append(body);
  conversation.append(message);
}

export function createTypingIndicator(conversation, time) {
  const { message, body } = createAssistantMessage(time);
  const indicator = createElement("div", "typing-indicator");
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-label", "Analyse de votre problème en cours");
  for (let dotIndex = 0; dotIndex < 3; dotIndex += 1) indicator.append(createElement("span"));
  body.append(indicator);
  conversation.append(message);
  return message;
}

export function appendAssistantMessage(conversation, result, { errorMessage, onRetry }) {
  const { message, body } = createAssistantMessage(formatTime());

  if (errorMessage) {
    const errorCard = createElement("div", "friendly-error");
    errorCard.setAttribute("role", "alert");
    errorCard.append(createElement("strong", "", "Un problème est survenu"), createElement("span", "", errorMessage));
    body.append(errorCard);
    appendRetryButton(body, onRetry);
  } else {
    renderSearchResult(body, result, onRetry);
  }

  conversation.append(message);
  scrollConversationToBottom(conversation);
}

export function resetConversation(conversation) {
  const { message, body } = createAssistantMessage("À l’instant");
  const bubble = createElement("div", "message-bubble");
  bubble.append(
    createElement("p", "", "Bonjour, je suis là pour vous aider."),
    createElement("p", "", "Quel problème rencontrez-vous avec votre GAB ? Décrivez ce que vous avez observé, avec vos mots."),
  );
  body.append(bubble);
  conversation.replaceChildren(message);
}

export function scrollConversationToBottom(conversation) {
  conversation.scrollTop = conversation.scrollHeight;
}
