/**
 * Appels à l'administration de l’ATM-Chatbot (API du chatbot), via le gateway :
 *
 *   navigateur -> /api/atm-chatbot-admin/<chemin>
 *   gateway    -> vérifie que la session est celle d'un administrateur (conteneur auth)
 *              -> relaie vers le chatbot sur /api/admin/<chemin> en ajoutant la clé ADMIN_API_KEY
 *
 * La page n'a donc jamais la clé : seul le cookie de session part.
 *
 * Les erreurs n'ont pas la même forme selon qui répond :
 *   - gateway / main app : { error: { message } }
 *   - chatbot (FastAPI)   : { detail: "texte" } ou, pour une validation, { detail: [{ loc, msg }] }
 * describeErrorBody() ramène les deux à un message lisible.
 */

import { ApiRequestError, redirectToLoginPage } from "/shared/js/apiClient.js";

const ATM_CHATBOT_ADMIN_API_PREFIX = "/api/atm-chatbot-admin";

function describeErrorBody(httpStatus, responseBody) {
  if (responseBody?.error?.message) {
    return responseBody.error.message;
  }
  const detail = responseBody?.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail) && detail.length) {
    // Validation pydantic : on garde le message, précédé du champ concerné.
    return detail
      .map((problem) => {
        const fieldName = (problem.loc ?? []).filter((part) => part !== "body").join(" › ");
        return fieldName ? `${fieldName} : ${problem.msg}` : problem.msg;
      })
      .join(" · ");
  }
  if (httpStatus === 503) {
    return "ATM-Chatbot momentanément indisponible. Vérifiez que le chatbot est démarré.";
  }
  if (httpStatus === 429) {
    return "Trop de requêtes. Patientez un instant.";
  }
  return "Erreur inattendue. Réessayez.";
}

/** Envoie `body` en JSON ; renvoie le JSON de la réponse, ou lève une ApiRequestError lisible. */
export async function requestAtmChatbotAdmin(path, { method = "GET", body = undefined } = {}) {
  const requestOptions = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
  if (body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${ATM_CHATBOT_ADMIN_API_PREFIX}${path}`, requestOptions);
  } catch {
    throw new ApiRequestError(0, "network_error", "Connexion au serveur impossible. Vérifiez votre réseau.");
  }

  if (response.status === 401) {
    redirectToLoginPage();
  }
  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(response.status, "atm_chatbot_admin_error", describeErrorBody(response.status, responseBody));
  }
  return responseBody;
}

/** Client « liste / ajout / modification / suppression » des réponses enregistrées (mêmes routes pour les deux ressources). */
function createSavedReplyResource(resourcePath) {
  return {
    list: () => requestAtmChatbotAdmin(resourcePath),
    create: (record) => requestAtmChatbotAdmin(resourcePath, { method: "POST", body: record }),
    update: (recordId, record) => requestAtmChatbotAdmin(`${resourcePath}/${encodeURIComponent(recordId)}`, { method: "PUT", body: record }),
    remove: (recordId) => requestAtmChatbotAdmin(`${resourcePath}/${encodeURIComponent(recordId)}`, { method: "DELETE" }),
  };
}

export const errorCodeResource = createSavedReplyResource("/error_code");
export const usualProblemResource = createSavedReplyResource("/usual_problem");

export const solutionProposalApi = {
  list: (status) => requestAtmChatbotAdmin(`/solution-proposals?status=${encodeURIComponent(status)}`),
  /** decision : "approve" | "reject" */
  review: (proposalId, decision, decisionBody) =>
    requestAtmChatbotAdmin(`/solution-proposals/${encodeURIComponent(proposalId)}/${decision}`, { method: "POST", body: decisionBody }),
};

export const interventionAddApi = {
  list: (status) => requestAtmChatbotAdmin(`/intervention_add?status=${encodeURIComponent(status)}`),
  /** Ce que l'approbation écrira, table par table (rien n'est écrit). */
  preview: (interventionAddId) => requestAtmChatbotAdmin(`/intervention_add/${encodeURIComponent(interventionAddId)}/preview`),
  review: (interventionAddId, decision, decisionBody) =>
    requestAtmChatbotAdmin(`/intervention_add/${encodeURIComponent(interventionAddId)}/${decision}`, { method: "POST", body: decisionBody }),
};
