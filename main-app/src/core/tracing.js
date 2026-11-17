/**
 * Traces de fonctionnement : une ligne JSON par événement, sur la sortie
 * standard (lue par `docker compose logs`). Même usage que trace() du chatbot.
 *
 * Règle de sécurité : on ne journalise JAMAIS un mot de passe, un token, un
 * cookie ni le contenu d'un message. Les clés sensibles sont masquées par
 * précaution, mais l'appelant ne doit de toute façon pas les passer.
 */

const SENSITIVE_DETAIL_KEY_PATTERN = /password|token|cookie|secret|authorization|content|sdp|candidate/i;

export function trace(category, message, details = {}) {
  // Tests : traces coupées pour garder un résultat lisible.
  if (process.env.MAIN_APP_ENVIRONMENT === "test") {
    return;
  }
  const traceLine = {
    timestamp: new Date().toISOString(),
    service: process.env.MAIN_APP_SERVICE_NAME ?? "main-app",
    category,
    message,
    details: maskSensitiveDetails(details),
  };
  process.stdout.write(`${JSON.stringify(traceLine)}\n`);
}

function maskSensitiveDetails(details) {
  const maskedDetails = {};
  for (const [detailKey, detailValue] of Object.entries(details ?? {})) {
    maskedDetails[detailKey] = SENSITIVE_DETAIL_KEY_PATTERN.test(detailKey) ? "[masqué]" : detailValue;
  }
  return maskedDetails;
}
