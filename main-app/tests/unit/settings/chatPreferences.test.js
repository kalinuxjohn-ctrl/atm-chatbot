import { jest } from "@jest/globals";

describe("préférences du chat partagées avec les paramètres globaux", () => {
  const savedGlobals = new Map(["window", "localStorage", "sessionStorage"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let preferences;
  let values;
  let storageListener;

  beforeEach(async () => {
    jest.resetModules();
    values = new Map();
    globalThis.localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
    globalThis.window = {
      location: { search: "" },
      addEventListener: (type, listener) => {
        if (type === "storage") storageListener = listener;
      },
    };
    globalThis.sessionStorage = { getItem: () => null };
    preferences = await import("../../../../frontend/public/js/services/preferencesService.js");
  });

  afterEach(() => {
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  test("enregistre immédiatement et conserve les autres choix", () => {
    preferences.updatePreferences({ avatar: "robot" });
    const listener = jest.fn();
    preferences.onPreferencesChange(listener);
    preferences.updatePreferences({ voiceModeEnabled: false });
    expect(preferences.getPreferences()).toMatchObject({ avatar: "robot", voiceModeEnabled: false });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ avatar: "robot", voiceModeEnabled: false }));
  });

  test("une autre fenêtre met à jour le chat sans réinitialiser la conversation", () => {
    const listener = jest.fn();
    preferences.onPreferencesChange(listener);
    values.set("atm-chatbot.preferences", JSON.stringify({ avatar: "male", autoRead: false }));
    storageListener({ key: "atm-chatbot.preferences", storageArea: localStorage });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ avatar: "male", autoRead: false }));
    listener.mockClear();
    storageListener({ key: "atm-chatbot.conversation", storageArea: localStorage });
    storageListener({ key: "atm-chatbot.preferences", storageArea: {} });
    expect(listener).not.toHaveBeenCalled();
    values.clear();
    storageListener({ key: null, storageArea: localStorage });
    expect(listener).toHaveBeenCalledWith(preferences.DEFAULT_PREFERENCES);
  });
});
