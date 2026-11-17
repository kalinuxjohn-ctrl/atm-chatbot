import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const mainThemeScript = readFileSync(new URL("../../../gateway/html/shared/js/applySavedTheme.js", import.meta.url), "utf8");
const chatbotThemeScript = readFileSync(new URL("../../../../frontend/public/js/applySavedTheme.js", import.meta.url), "utf8");
const embeddedScript = readFileSync(new URL("../../../../frontend/public/js/embeddedMode.js", import.meta.url), "utf8");
const mainStyles = readFileSync(new URL("../../../gateway/html/shared/css/base.css", import.meta.url), "utf8");
const chatbotStyles = readFileSync(new URL("../../../../frontend/public/css/theme.css", import.meta.url), "utf8");

function palette(styles, theme) {
  const selector = theme === "light" ? ":root" : `:root[data-theme="${theme}"]`;
  const block = styles.slice(styles.indexOf(`\n${selector}`));
  const declarations = block.slice(block.indexOf("{"), block.indexOf("}"));
  return Object.fromEntries([...declarations.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]]));
}

function contrast(first, second) {
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((part) => {
      const channel = parseInt(part, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("thèmes disponibles", () => {
  test.each(["light", "dark", "gab"])("la sidebar %s a un fond distinct et une deconnexion orange lisible", (theme) => {
    const base = palette(mainStyles, "light");
    const tokens = { ...base, ...palette(mainStyles, theme) };
    expect(tokens["--sidebar-background"]).toContain("linear-gradient(135deg");
    expect(tokens["--sidebar-logout-color"]).toBe(theme === "dark" ? "#fb923c" : "#b45309");
    expect(contrast(tokens["--sidebar-logout-color"], tokens["--color-surface"])).toBeGreaterThanOrEqual(4.5);
  });

  test.each(["light", "dark", "gab"])("les textes et surfaces %s restent neutres, sans teinte marron", (theme) => {
    const main = palette(mainStyles, theme);
    const chat = palette(chatbotStyles, theme);
    const text = theme === "dark" ? ["#f3f4f5", "#d3d7dc", "#b0b7bf"] : ["#202428", "#41474d", "#5e656d"];
    expect(["--color-text", "--color-text-soft", "--color-text-muted"].map((key) => main[key])).toEqual(text);
    expect(["--text", "--text-soft", "--text-muted"].map((key) => chat[key])).toEqual(text);
    expect(main["--color-surface"]).toBe(theme === "dark" ? "#1b1e21" : "#ffffff");
    expect(chat["--surface"]).toBe(main["--color-surface"]);
    expect(main["--color-own-message"]).toBe(theme === "dark" ? "#25292d" : "#ffffff");
    expect(chat["--user-bubble-bg"]).toBe(main["--color-own-message"]);
  });

  test.each(["light", "dark", "gab"])("la palette marron %s est synchronisée et lisible", (theme) => {
    const main = palette(mainStyles, theme);
    const chat = palette(chatbotStyles, theme);
    expect(main["--color-text"]).toBe(chat["--text"]);
    expect(main["--color-accent"]).toBe(chat["--teal-strong"]);
    for (const token of ["--color-text", "--color-text-soft", "--color-text-muted", "--color-accent-strong"]) {
      expect(contrast(main[token], main["--color-surface"])).toBeGreaterThanOrEqual(4.5);
    }
    for (const token of ["--text", "--text-soft", "--text-muted", "--accent-text"]) {
      expect(contrast(chat[token], chat["--surface"])).toBeGreaterThanOrEqual(4.5);
    }
    for (const endpoint of main["--gradient-accent"].match(/#[\da-f]{6}/g)) {
      expect(contrast(main["--color-accent-text"], endpoint)).toBeGreaterThanOrEqual(4.5);
    }
    for (const endpoint of chat["--gradient"].match(/#[\da-f]{6}/g)) {
      expect(contrast(chat["--on-accent"], endpoint)).toBeGreaterThanOrEqual(4.5);
    }
  });

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
