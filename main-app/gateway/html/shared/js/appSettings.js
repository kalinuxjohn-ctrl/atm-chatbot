import { createElementWithText } from "./domHelpers.js";
import { browserNotificationsEnabled, setBrowserNotificationsEnabled } from "./messageNotifications.js";

export function createAppSettings({ applyTheme }) {
  const dialog = createElementWithText("dialog", "app-settings-dialog");
  dialog.setAttribute("aria-labelledby", "app-settings-title");
  const title = createElementWithText("h2", "", "Paramètres");
  title.id = "app-settings-title";
  const close = createElementWithText("button", "button button-secondary", "Fermer");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.target.closest("select")) {
      event.preventDefault();
      dialog.close();
    }
  });
  function createSection(label) {
    const section = createElementWithText("section", "app-settings-section");
    const heading = createElementWithText("h3", "", label);
    const content = createElementWithText("div", "app-settings-section-content");
    section.append(heading, content);
    return { section, content };
  }
  const appearance = createSection("Apparence");
  const themeLabel = createElementWithText("label", "app-settings-field", "Thème");
  const theme = document.createElement("select");
  theme.setAttribute("aria-label", "Thème de l’application");
  for (const [value, label] of [["light", "Clair"], ["dark", "Sombre"], ["gab", "GAB · Marron & Crème"]]) {
    const option = createElementWithText("option", "", label);
    option.value = value;
    theme.append(option);
  }
  theme.addEventListener("change", () => applyTheme(theme.value));
  themeLabel.append(theme);
  appearance.content.append(themeLabel);

  const notifications = createSection("Notifications");
  const limitation = createElementWithText("p", "muted", "Application ouverte uniquement. Les badges restent actifs.");
  const enable = createElementWithText("button", "button button-secondary");
  enable.type = "button";
  const status = createElementWithText("p", "muted");
  status.setAttribute("role", "status");
  function sync() {
    const supported = "Notification" in window && window.isSecureContext;
    const enabled = browserNotificationsEnabled();
    enable.disabled = !supported && !enabled;
    enable.setAttribute("aria-pressed", String(enabled && supported && Notification.permission === "granted"));
    enable.textContent = enabled ? "Désactiver les notifications" : "Activer les notifications";
    const permission = supported ? Notification.permission : "unsupported";
    status.textContent = permission === "unsupported" ? "Notifications indisponibles ici (navigateur compatible et HTTPS requis)."
      : permission === "denied" ? "Permission refusée : modifiez les autorisations du site dans votre navigateur."
        : enabled && permission === "granted" ? "Notifications du navigateur activées." : "Notifications du navigateur désactivées.";
  }
  enable.addEventListener("click", async () => {
    enable.disabled = true;
    try {
      await setBrowserNotificationsEnabled(!browserNotificationsEnabled());
      sync();
    } catch {
      sync();
      status.textContent = "Impossible d’activer les notifications sur ce navigateur.";
    }
  });
  notifications.content.append(enable, status, limitation);
  const chat = createSection("Chat");
  const chatStatus = createElementWithText("p", "muted", "Chargement des paramètres…");
  chatStatus.setAttribute("role", "status");
  const retry = createElementWithText("button", "button button-secondary", "Réessayer");
  retry.type = "button";
  retry.hidden = true;
  chat.content.append(chatStatus, retry);
  let chatPanel;
  let loadingChat = false;
  async function loadChatSettings() {
    if (chatPanel) {
      chatPanel.refresh();
      return;
    }
    if (loadingChat) return;
    loadingChat = true;
    retry.hidden = true;
    chatStatus.textContent = "Chargement des paramètres…";
    try {
      const [response, { createSettingsPanel }] = await Promise.all([
        fetch("/atm-chatbot/app/atm-chatbot.html"),
        import("/atm-chatbot/app/js/components/settingsPanel.js"),
      ]);
      if (!response.ok || response.redirected) throw new Error(`Chat settings HTTP ${response.status}`);
      const source = new DOMParser().parseFromString(await response.text(), "text/html");
      const form = source.querySelector("#settings-dialog form");
      if (!form) throw new Error("Chat settings form missing");
      form.querySelector(".dialog-header")?.remove();
      form.querySelector(".dialog-actions")?.remove();
      form.querySelector("[data-theme-settings]")?.closest("fieldset").remove();
      form.removeAttribute("method");
      const container = createElementWithText("div", "app-chat-settings");
      container.append(document.importNode(form, true));
      chatPanel = createSettingsPanel({ dialog: container });
      chat.content.append(container);
      chatStatus.hidden = true;
      chatPanel.refresh();
      if (pendingChatFocus) chat.section.scrollIntoView({ block: "start" });
    } catch (error) {
      console.error("Chargement des paramètres du chat impossible.", error);
      chatStatus.textContent = "Paramètres du chat indisponibles.";
      retry.hidden = false;
    } finally {
      loadingChat = false;
    }
  }
  let pendingChatFocus = false;
  retry.addEventListener("click", () => void loadChatSettings());
  const header = createElementWithText("header", "app-settings-header");
  const scrollArea = createElementWithText("div", "app-settings-scroll");
  const footer = createElementWithText("footer", "app-settings-footer");
  header.append(title);
  scrollArea.append(appearance.section, notifications.section, chat.section);
  footer.append(close);
  dialog.append(header, scrollArea, footer);
  document.body.append(dialog);
  return {
    open({ section } = {}) {
      theme.value = document.documentElement.dataset.theme || "light";
      sync();
      pendingChatFocus = section === "chat";
      if (!dialog.open) dialog.showModal();
      if (pendingChatFocus) chat.section.scrollIntoView({ block: "start" });
      else scrollArea.scrollTop = 0;
      void loadChatSettings();
    },
  };
}
