import { createElementWithText } from "/shared/js/domHelpers.js";
import { actionCatalogApi } from "./atmChatbotAdminApi.js";
import { showSectionStatus } from "./administrationWidgets.js";

export function connectActionCatalogSection(section, onActionsChanged) {
  const form = section.querySelector("[data-action-catalog-form]");
  const actionInput = form.elements.canonical_text;
  const deviceTypeInput = form.elements.device_type;
  const statusLine = section.querySelector("[data-action-catalog-status]");
  const searchInput = section.querySelector("[data-action-catalog-search]");
  const lists = {
    gab: section.querySelector('[data-action-catalog-list="gab"]'),
    tpe: section.querySelector('[data-action-catalog-list="tpe"]'),
  };
  const submitButton = form.querySelector('button[type="submit"]');
  let actions = [];

  function renderActions() {
    const search = searchInput.value.trim().toLocaleLowerCase();
    for (const [deviceType, list] of Object.entries(lists)) {
      const filteredActions = actions.filter((action) =>
        (!action.device_type || action.device_type === deviceType)
        && action.canonical_text.toLocaleLowerCase().includes(search),
      );
      list.replaceChildren(...filteredActions.map((action) => {
        const item = createElementWithText("li", "card action-catalog-item");
        const details = createElementWithText("div", "action-catalog-item-details");
        details.append(createElementWithText("span", "", action.canonical_text));
        if (!action.device_type) {
          details.append(createElementWithText("small", "action-catalog-shared-label", "Commun GAB / TPE"));
        }
        item.append(
          details,
          createElementWithText("small", "muted", `Action n° ${action.action_id}`),
        );
        return item;
      }));
      if (filteredActions.length === 0) {
        const hasCategoryActions = actions.some((action) => !action.device_type || action.device_type === deviceType);
        list.append(createElementWithText(
          "li",
          "muted action-catalog-empty",
          hasCategoryActions ? "Aucune action correspondante." : "Aucune action dans cette catégorie.",
        ));
      }
    }
  }

  async function load() {
    showSectionStatus(statusLine, "Chargement du catalogue…");
    try {
      actions = await actionCatalogApi.list();
      onActionsChanged(actions);
      renderActions();
      showSectionStatus(statusLine, `${actions.length} action${actions.length === 1 ? "" : "s"} au catalogue. Les actions communes apparaissent dans les deux listes.`);
    } catch (error) {
      showSectionStatus(statusLine, error.message, { isError: true });
    }
  }

  searchInput.addEventListener("input", renderActions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    showSectionStatus(statusLine, "");
    try {
      const selectedType = deviceTypeInput.value;
      const action = await actionCatalogApi.create({
        canonical_text: actionInput.value.trim(),
        device_type: selectedType === "shared" ? null : selectedType,
      });
      actions = [...actions, action].sort((first, second) =>
        first.canonical_text.localeCompare(second.canonical_text, "fr", { sensitivity: "base" }),
      );
      onActionsChanged(actions);
      renderActions();
      form.reset();
      showSectionStatus(statusLine, `« ${action.canonical_text} » ajoutée au catalogue.`);
      actionInput.focus();
    } catch (error) {
      showSectionStatus(statusLine, error.message, { isError: true });
    } finally {
      submitButton.disabled = false;
    }
  });

  return { load };
}
