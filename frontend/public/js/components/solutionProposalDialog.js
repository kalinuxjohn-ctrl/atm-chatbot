/**
 * Fenêtre « Proposer une solution » (quand aucune solution du Copilote n'a marché).
 *
 *   ouverture ─> chargement du problème (backend) ─> formulaire ─> envoi ─> confirmation
 *                         └─ erreur claire si aucun problème n'est identifié
 *
 * Le problème affiché vient TOUJOURS du backend (solutionProposalApi) : le
 * technicien ne saisit que son action et son résultat, jamais d'identifiant.
 */

import { getFriendlyErrorMessage } from "../core/httpClient.js";
import { getProposalContext, submitProposal } from "../services/api/solutionProposalApi.js";
import { createElement } from "../utils/dom.js";

const MIN_TEXT_LENGTH = 5;

/**
 * @param {{ dialog: HTMLDialogElement, onSubmitted: (reply: string) => void }} options
 *        onSubmitted : la proposition est enregistrée, `reply` est le message à afficher dans le fil
 */
export function createSolutionProposalDialog({ dialog, onSubmitted }) {
  const form = dialog.querySelector("[data-proposal-form]");
  const loading = dialog.querySelector("[data-proposal-loading]");
  const errorBox = dialog.querySelector("[data-proposal-error]");
  const problemSection = dialog.querySelector("[data-proposal-problem]");
  const problemDetails = dialog.querySelector("[data-proposal-details]");
  const previousSection = dialog.querySelector("[data-proposal-previous]");
  const previousList = dialog.querySelector("[data-proposal-previous-list]");
  const previousCount = dialog.querySelector("[data-proposal-previous-count]");
  const fields = dialog.querySelector("[data-proposal-fields]");
  const success = dialog.querySelector("[data-proposal-success]");
  const cancelButton = dialog.querySelector("[data-proposal-cancel]");
  const submitButton = dialog.querySelector("[data-proposal-submit]");

  let target = null; // { conversationId, technicianId } de la proposition en cours
  let requestToken = 0; // ignore les réponses d'une ouverture précédente (fenêtre fermée entre-temps)

  function setState(state) {
    dialog.dataset.state = state;
    loading.hidden = state !== "loading";
    problemSection.hidden = !["ready", "submitting"].includes(state);
    fields.hidden = !["ready", "submitting"].includes(state);
    success.hidden = state !== "success";
    submitButton.hidden = !["ready", "submitting"].includes(state);
    submitButton.disabled = state === "submitting";
    submitButton.textContent = state === "submitting" ? "Envoi…" : "Envoyer la proposition";
    cancelButton.textContent = state === "success" || state === "load-error" ? "Fermer" : "Annuler";
    form.querySelectorAll("textarea, input").forEach((control) => {
      control.disabled = state === "submitting";
    });
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  /** Le backend explique lui-même les refus métier (pas de problème identifié, autre technicien…). */
  function describeError(error) {
    if (error?.detail && [403, 404, 409, 422].includes(error.status)) return error.detail;
    return getFriendlyErrorMessage(error);
  }

  function renderProblem(proposalContext) {
    const { problem, interventionId, referencePosition, previousResults } = proposalContext;
    const rows = [
      ["Problème actuel", problem.label],
      ["Composant", problem.componentName],
      ["Équipement", problem.deviceLabel],
      ["Code d’erreur", problem.errorCode],
      ["Cas de référence", interventionId ? `Intervention n° ${interventionId}` : null],
    ].filter(([, value]) => value);
    problemDetails.replaceChildren(
      ...rows.flatMap(([label, value]) => [createElement("dt", "", label), createElement("dd", "", value)]),
    );

    previousSection.hidden = previousResults.length === 0;
    previousCount.textContent = String(previousResults.length);
    previousList.replaceChildren(
      ...previousResults.map((result) => {
        const item = createElement("li", result.position === referencePosition ? "is-reference" : "");
        item.append(createElement("span", "proposal-previous-solution", result.solutionText || "Solution non précisée"));
        if (result.symptomText) item.append(createElement("span", "proposal-previous-symptom", result.symptomText));
        return item;
      }),
    );
  }

  async function open({ conversationId, technicianId }) {
    target = { conversationId, technicianId };
    const token = ++requestToken;
    form.reset();
    showError("");
    setState("loading");
    if (!dialog.open) dialog.showModal();

    if (!Number.isInteger(conversationId)) {
      showError("Aucune conversation en cours : décrivez d’abord la panne au Copilote.");
      setState("load-error");
      return;
    }
    try {
      const proposalContext = await getProposalContext({ conversationId, technicianId });
      if (token !== requestToken) return;
      renderProblem(proposalContext);
      setState("ready");
      form.elements.proposedAction.focus();
    } catch (error) {
      if (token !== requestToken) return;
      showError(describeError(error));
      setState("load-error");
    }
  }

  function readForm() {
    const proposedAction = form.elements.proposedAction.value.trim();
    const resultDescription = form.elements.resultDescription.value.trim();
    const outcomeStatus = form.elements.outcomeStatus.value || "resolved";
    if (proposedAction.length < MIN_TEXT_LENGTH) return { error: "Décrivez l’action que vous avez réalisée.", field: "proposedAction" };
    if (resultDescription.length < MIN_TEXT_LENGTH) return { error: "Décrivez le résultat obtenu.", field: "resultDescription" };
    return { proposedAction, resultDescription, outcomeStatus };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (dialog.dataset.state !== "ready") return;
    const values = readForm();
    if (values.error) {
      showError(values.error);
      form.elements[values.field].focus();
      return;
    }

    showError("");
    setState("submitting");
    try {
      const { reply } = await submitProposal({ ...target, ...values });
      // Même si la fenêtre a été fermée pendant l'envoi : la proposition est
      // enregistrée côté serveur, la confirmation doit apparaître dans le fil.
      onSubmitted(reply);
      setState("success");
      if (dialog.open) cancelButton.focus();
    } catch (error) {
      showError(describeError(error));
      setState("ready");
    }
  });

  cancelButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    requestToken += 1; // une réponse arrivant après la fermeture est ignorée
  });

  return { open };
}
