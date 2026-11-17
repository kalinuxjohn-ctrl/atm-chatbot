import { createElementWithText } from "/shared/js/domHelpers.js";
import { deviceModelCatalogApi } from "./atmChatbotAdminApi.js";
import { showSectionStatus } from "./administrationWidgets.js";

const DEVICE_TYPE_LABELS = { gab: "GAB", tpe: "TPE" };

export function connectDeviceModelsSection(section) {
  const form = section.querySelector("[data-device-model-form]");
  const errorLine = section.querySelector("[data-device-model-error]");
  const statusLine = section.querySelector("[data-device-model-status]");
  const list = section.querySelector("[data-device-model-list]");
  const submitButton = form.querySelector('button[type="submit"]');

  function renderModels(models) {
    if (!models.length) {
      list.replaceChildren(createElementWithText("li", "muted device-model-empty", "Aucun modèle enregistré."));
      return;
    }

    list.replaceChildren(...models.map((model) => {
      const item = createElementWithText("li", "card device-model-item");
      const heading = createElementWithText("div", "device-model-item-heading");
      heading.append(
        createElementWithText("span", "device-model-type", DEVICE_TYPE_LABELS[model.device_type] || "Type non précisé"),
        createElementWithText("h3", "", model.model_name),
      );
      item.append(
        heading,
        createElementWithText("p", "device-model-manufacturer", model.manufacturer_name || "Fabricant non précisé"),
      );
      if (model.release_year) {
        item.append(createElementWithText("p", "muted", `Année de sortie : ${model.release_year}`));
      }

      const versions = model.versions || [];
      if (versions.length) {
        const versionList = createElementWithText("ul", "device-model-versions");
        for (const version of versions) {
          const parts = [version.version_label];
          if (version.hardware_rev) parts.push(`Révision ${version.hardware_rev}`);
          versionList.append(createElementWithText("li", "", parts.join(" · ")));
          if (version.notes) {
            versionList.lastElementChild.append(createElementWithText("p", "muted", version.notes));
          }
        }
        item.append(versionList);
      } else {
        item.append(createElementWithText("p", "muted", "Aucune version enregistrée."));
      }
      return item;
    }));
  }

  async function load() {
    showSectionStatus(statusLine, "Chargement des modèles…");
    try {
      const models = await deviceModelCatalogApi.list();
      renderModels(models);
      showSectionStatus(statusLine, `${models.length} modèle${models.length === 1 ? "" : "s"} au catalogue.`);
    } catch (error) {
      showSectionStatus(statusLine, error.message, { isError: true });
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorLine.hidden = true;
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const releaseYear = String(formData.get("release_year") || "").trim();
    const payload = {
      device_type: formData.get("device_type"),
      manufacturer_name: String(formData.get("manufacturer_name")).trim(),
      model_name: String(formData.get("model_name")).trim(),
      release_year: releaseYear ? Number(releaseYear) : null,
      version_label: String(formData.get("version_label") || "").trim() || null,
      hardware_rev: String(formData.get("hardware_rev") || "").trim() || null,
      notes: String(formData.get("notes") || "").trim() || null,
    };

    submitButton.disabled = true;
    showSectionStatus(statusLine, "");
    try {
      const created = await deviceModelCatalogApi.create(payload);
      form.reset();
      showSectionStatus(
        statusLine,
        `Modèle « ${created.model_name} » (${DEVICE_TYPE_LABELS[created.device_type]}) ajouté au catalogue.`,
      );
      await load();
    } catch (error) {
      errorLine.textContent = error.message;
      errorLine.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  return { load };
}
