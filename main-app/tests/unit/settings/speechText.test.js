import { jest } from "@jest/globals";

// Minimal text-only DOM for the renderer; no HTML parsing or browser emulation.
function textNode(localName = "", text = "") {
  const children = [];
  return {
    localName,
    get children() { return children.filter((child) => child.localName); },
    get textContent() { return text + children.map((child) => child.textContent).join(""); },
    set textContent(value) { text = value; children.length = 0; },
    append(...nodes) { children.push(...nodes); },
  };
}

describe("texte Markdown lu par les voix du chatbot", () => {
  const savedGlobals = new Map(
    ["window", "document", "sessionStorage", "fetch", "Audio", "SpeechSynthesisUtterance"]
      .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  let synthesis;
  let markdown;
  let browserSpeech;
  let serverAvailable;

  beforeEach(async () => {
    jest.resetModules();
    serverAvailable = true;
    browserSpeech = jest.fn((utterance) => queueMicrotask(() => utterance.onend()));
    globalThis.document = {
      createElement: (name) => textNode(name),
      createTextNode: (text) => textNode("", text),
      createDocumentFragment: () => textNode(),
    };
    globalThis.sessionStorage = { getItem: () => null };
    globalThis.window = {
      location: { search: "" },
      speechSynthesis: {
        getVoices: () => [{
          name: "Denise", lang: "fr-FR", voiceURI: "browser:denise", localService: true,
        }],
        speak: browserSpeech,
        cancel: jest.fn(),
      },
    };
    globalThis.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };
    globalThis.Audio = class {
      play() { queueMicrotask(() => this.onended()); return Promise.resolve(); }
    };
    globalThis.fetch = jest.fn(async (url) => {
      if (url.endsWith("/voices")) {
        return { ok: true, json: async () => ({
          voices: [{ id: "fr-FR-DeniseNeural", name: "Denise", gender: "female", locale: "fr-FR" }],
        }) };
      }
      return { ok: serverAvailable, status: 503, blob: async () => new Blob(["test"]) };
    });
    markdown = await import("../../../../frontend/public/js/utils/messageMarkdown.js");
    synthesis = await import("../../../../frontend/public/js/services/speech/speechSynthesisService.js");
  });

  afterEach(() => {
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  test.each([
    ["Vérifiez **le câble**, puis ***redémarrez***.", "Vérifiez le câble, puis redémarrez."],
    ["__Important__ : *coupez* le courant, code `E42`.", "Important : coupez le courant, code E42."],
    ["## Diagnostic\n- **Câble**\n- Alimentation\n\n1. ***Tester***\n2. Redémarrer",
      "Diagnostic\nCâble\nAlimentation\nTester\nRedémarrer"],
    ["Calcul : 2 * 3. Référence A_B.", "Calcul : 2 * 3. Référence A_B."],
    ["**incomplet", "**incomplet"],
    ["```txt\n2 ** 3\n```", "2 ** 3"],
    ["Bonjour, vérifiez le GAB.", "Bonjour, vérifiez le GAB."],
  ])("conserve les mots et retire seulement la mise en forme : %s", (input, expected) => {
    expect(markdown.messageMarkdownToText(input)).toBe(expected);
  });

  test("envoie le texte sans astérisques au serveur avant découpage", async () => {
    const text = `**${"Vérifiez le câble ".repeat(12).trim()}**. Puis ***redémarrez***.`;
    await synthesis.speak(text, { voiceURI: null, voiceGender: "female" });
    const chunks = fetch.mock.calls
      .filter(([, options]) => options?.method === "POST")
      .map(([, options]) => JSON.parse(options.body).text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toBe(markdown.messageMarkdownToText(text));
    expect(browserSpeech).not.toHaveBeenCalled();
  });

  test("la voix du navigateur utilise aussi le texte nettoyé", async () => {
    await synthesis.speak("Contrôlez ***le câble***.", {
      voiceURI: "browser:denise", voiceGender: "female",
    });
    expect(browserSpeech.mock.calls[0][0].text).toBe("Contrôlez le câble.");
  });

  test("le repli navigateur ne réintroduit pas les marqueurs", async () => {
    serverAvailable = false;
    await synthesis.speak("Contrôlez **le câble**.", { voiceURI: null, voiceGender: "female" });
    expect(browserSpeech.mock.calls[0][0].text).toBe("Contrôlez le câble.");
  });

  test("une mise en forme sans texte ne déclenche pas de lecture", async () => {
    await synthesis.speak("```", { voiceURI: null, voiceGender: "female" });
    expect(fetch).not.toHaveBeenCalled();
    expect(browserSpeech).not.toHaveBeenCalled();
  });
});
