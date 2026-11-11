import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const mainThemeScript = readFileSync(new URL("../../../gateway/html/shared/js/applySavedTheme.js", import.meta.url), "utf8");
const chatbotThemeScript = readFileSync(new URL("../../../../frontend/public/js/applySavedTheme.js", import.meta.url), "utf8");
const embeddedScript = readFileSync(new URL("../../../../frontend/public/js/embeddedMode.js", import.meta.url), "utf8");

describe("thèmes disponibles", () => {
  test.each(["light", "dark", "gab"])("la main app restaure %s sans changer le choix", (theme) => {
    const document = { documentElement: { dataset: {} } };
    runInNewContext(mainThemeScript, { document, window: {
      localStorage: { getItem: () => theme },
      matchMedia: () => ({ matches: false }),
    } });
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  test("un ancien choix inconnu garde le comportement système", () => {
    const document = { documentElement: { dataset: {} } };
    runInNewContext(mainThemeScript, { document, window: {
      localStorage: { getItem: () => "invalid" },
      matchMedia: () => ({ matches: true }),
    } });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test.each(["dark", "gab"])("le chatbot autonome restaure %s", (theme) => {
    const document = { documentElement: { dataset: {} } };
    runInNewContext(chatbotThemeScript, { document, localStorage: { getItem: () => theme } });
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  test("le mode intégré applique GAB et écoute seulement la fenêtre parente", () => {
    const document = { documentElement: { dataset: {} } };
    const parent = {};
    let listener;
    runInNewContext(embeddedScript, { document, URLSearchParams, window: {
      location: { search: "?embedded=1&theme=gab", origin: "http://localhost:8080" },
      parent,
      addEventListener: (_event, handler) => { listener = handler; },
    } });
    expect(document.documentElement.dataset.theme).toBe("gab");
    listener({ origin: "http://localhost:8080", source: {}, data: { type: "espace-techniciens:theme", theme: "dark" } });
    listener({ origin: "https://other.example", source: parent, data: { type: "espace-techniciens:theme", theme: "dark" } });
    expect(document.documentElement.dataset.theme).toBe("gab");
    listener({ origin: "http://localhost:8080", source: parent, data: { type: "espace-techniciens:theme", theme: "dark" } });
    expect(document.documentElement.dataset.theme).toBe("dark");
    listener({ origin: "http://localhost:8080", source: parent, data: { type: "espace-techniciens:theme", theme: "light" } });
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
