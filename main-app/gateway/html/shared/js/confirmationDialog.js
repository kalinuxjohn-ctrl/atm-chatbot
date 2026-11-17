import { createElementWithText } from "./domHelpers.js";

export function confirmAction({ title, message, confirmLabel = "Oui", cancelLabel = "Non", danger = false }) {
  const dialog = createElementWithText("dialog", "app-confirmation-dialog");
  const heading = createElementWithText("h2", "", title);
  const description = createElementWithText("p", "", message);
  const actions = createElementWithText("div", "app-confirmation-actions");
  const cancelButton = createElementWithText("button", "button button-secondary", cancelLabel);
  const confirmButton = createElementWithText(
    "button",
    danger ? "button button-danger" : "button",
    confirmLabel,
  );

  heading.id = "app-confirmation-title";
  description.id = "app-confirmation-description";
  dialog.setAttribute("aria-labelledby", heading.id);
  dialog.setAttribute("aria-describedby", description.id);
  cancelButton.type = "button";
  cancelButton.autofocus = true;
  confirmButton.type = "button";
  cancelButton.addEventListener("click", () => dialog.close("cancel"));
  confirmButton.addEventListener("click", () => dialog.close("confirm"));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close("cancel");
  });
  actions.append(cancelButton, confirmButton);
  dialog.append(heading, description, actions);
  document.body.append(dialog);

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "confirm");
      dialog.remove();
    }, { once: true });
    dialog.showModal();
  });
}
