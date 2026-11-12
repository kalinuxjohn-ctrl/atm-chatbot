import { createElement } from "../utils/dom.js";
import { ApiRequestError, getFriendlyErrorMessage } from "../core/httpClient.js";
import { listConversations } from "../services/api/conversationApi.js";

export function createConversationHistory({ dialog, technicianId, onResume }) {
  const list = dialog.querySelector("[data-history-list]");
  const status = dialog.querySelector("[data-history-status]");
  const more = dialog.querySelector("[data-history-more]");
  const retry = dialog.querySelector("[data-history-retry]");
  let offset = 0;
  let busy = false;
  let failedAction = null;

  function setBusy(value) {
    busy = value;
    dialog.setAttribute("aria-busy", String(value));
    dialog.querySelectorAll("[data-history-resume], [data-history-more], [data-history-retry], [data-history-close]")
      .forEach((button) => { button.disabled = value; });
  }

  function showError(error, action) {
    console.error("L'historique des conversations n'a pas pu être chargé.", error);
    status.textContent = error instanceof ApiRequestError && error.status === 404
      ? "Cette conversation n'est plus accessible. Fermez puis rechargez l'historique."
      : getFriendlyErrorMessage(error);
    failedAction = action;
    retry.hidden = false;
  }

  async function resume(conversationId) {
    if (busy) return;
    setBusy(true);
    retry.hidden = true;
    status.textContent = "Ouverture de la conversation…";
    try {
      await onResume(conversationId);
      dialog.close();
    } catch (error) {
      showError(error, () => resume(conversationId));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (busy) return;
    setBusy(true);
    retry.hidden = true;
    status.textContent = "Chargement…";
    try {
      const page = await listConversations(technicianId, offset);
      for (const conversation of page.items) {
        const button = createElement("button", "conversation-history-item");
        button.type = "button";
        button.dataset.historyResume = String(conversation.conversation_id);
        const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" })
          .format(new Date(conversation.updated_at));
        button.append(createElement("strong", "", conversation.title),
          createElement("span", "", `Conversation n° ${conversation.conversation_id} · ${date}`));
        button.addEventListener("click", () => void resume(conversation.conversation_id));
        list.append(button);
      }
      offset += page.items.length;
      more.hidden = !page.has_more;
      status.textContent = offset ? `${offset} conversation${offset > 1 ? "s" : ""} affichée${offset > 1 ? "s" : ""}.` : "Aucune conversation enregistrée pour le moment.";
    } catch (error) {
      showError(error, loadMore);
    } finally {
      setBusy(false);
    }
  }

  more.addEventListener("click", () => void loadMore());
  retry.addEventListener("click", () => void failedAction?.());
  dialog.querySelector("[data-history-close]").addEventListener("click", () => {
    if (!busy) dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });

  return {
    open() {
      if (busy || dialog.open) return;
      offset = 0;
      list.replaceChildren();
      more.hidden = true;
      dialog.showModal();
      void loadMore();
    },
  };
}
