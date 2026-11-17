import { jest } from "@jest/globals";
import { advanceNotificationState } from "../../../gateway/html/shared/js/messageNotifications.js";

const state = (conversationId, latestIncomingMessageId, unreadCount = 1) => ({
  conversationId, latestIncomingMessageId, unreadCount,
});

describe("activation explicite des notifications navigateur", () => {
  const savedGlobals = new Map(["window", "document", "Notification", "fetch"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let notifications;
  let values;
  let window;
  let Notification;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.resetModules();
    values = new Map();
    window = globalThis.window = {
      localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
      isSecureContext: true,
      addEventListener: jest.fn(),
    };
    globalThis.document = { addEventListener: jest.fn() };
    Notification = globalThis.Notification = {
      permission: "default",
      requestPermission: jest.fn(async () => {
        Notification.permission = "granted";
        return "granted";
      }),
    };
    window.Notification = Notification;
    globalThis.fetch = jest.fn().mockRejectedValue(new Error("Fixture hors ligne"));
    notifications = await import("../../../gateway/html/shared/js/messageNotifications.js");
    notifications.startMessageNotifications({ technicianId: 99 });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  test("le démarrage ne demande jamais de permission ; seul l'opt-in la demande", async () => {
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    expect(notifications.browserNotificationsEnabled()).toBe(false);
    expect(await notifications.setBrowserNotificationsEnabled(true)).toBe(true);
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(values.get("main-app-notifications:99:enabled")).toBe("true");
    expect(notifications.browserNotificationsEnabled()).toBe(true);
    await notifications.setBrowserNotificationsEnabled(false);
    expect(notifications.browserNotificationsEnabled()).toBe(false);
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
  });

  test("un refus ne mémorise pas une activation ; HTTPS et support sont obligatoires", async () => {
    Notification.requestPermission.mockResolvedValue("denied");
    expect(await notifications.setBrowserNotificationsEnabled(true)).toBe(false);
    expect(notifications.browserNotificationsEnabled()).toBe(false);
    window.isSecureContext = false;
    expect(await notifications.setBrowserNotificationsEnabled(true)).toBe(false);
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    window.isSecureContext = true;
    delete window.Notification;
    expect(await notifications.setBrowserNotificationsEnabled(true)).toBe(false);
  });

  test("une permission déjà accordée ne vaut pas opt-in et le choix est isolé par utilisateur", async () => {
    Notification.permission = "granted";
    expect(notifications.browserNotificationsEnabled()).toBe(false);
    await notifications.setBrowserNotificationsEnabled(true);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    jest.resetModules();
    const reloaded = await import("../../../gateway/html/shared/js/messageNotifications.js");
    reloaded.startMessageNotifications({ technicianId: 99 });
    expect(reloaded.browserNotificationsEnabled()).toBe(true);
    jest.resetModules();
    const otherUser = await import("../../../gateway/html/shared/js/messageNotifications.js");
    otherUser.startMessageNotifications({ technicianId: 100 });
    expect(otherUser.browserNotificationsEnabled()).toBe(false);
  });

  test("le stockage indisponible garde le choix pour l'onglet sans faire échouer le panneau", async () => {
    window.localStorage.getItem = () => { throw new Error("Stockage bloqué"); };
    window.localStorage.setItem = () => { throw new Error("Stockage bloqué"); };
    expect(await notifications.setBrowserNotificationsEnabled(true)).toBe(true);
    expect(notifications.browserNotificationsEnabled()).toBe(true);
    expect(await notifications.setBrowserNotificationsEnabled(false)).toBe(true);
    expect(notifications.browserNotificationsEnabled()).toBe(false);
  });
});

describe("curseurs de notifications", () => {
  test("initialise les badges sans notifier l'historique, même non lu", () => {
    expect(advanceNotificationState(null, [state(1, 25, 12)]))
      .toEqual({ next: { 1: 25 }, arrivals: [] });
  });

  test("ne notifie ni les lectures ni les propres messages ni un polling répété", () => {
    const previous = { 1: 25 };
    expect(advanceNotificationState(previous, [state(1, 25, 0)]).arrivals).toEqual([]);
    expect(advanceNotificationState(previous, [state(1, 25, 3)]).arrivals).toEqual([]);
    expect(previous).toEqual({ 1: 25 });
  });

  test("notifie un nouveau message entrant et une nouvelle conversation", () => {
    const incoming = [state(1, 26), state(2, 27)];
    const { next, arrivals } = advanceNotificationState({ 1: 25 }, incoming);
    expect(arrivals).toEqual(incoming);
    expect(advanceNotificationState(next, incoming).arrivals).toEqual([]);
  });

  test("ne recule pas après une réponse ancienne et ne notifie pas un message déjà lu", () => {
    expect(advanceNotificationState({ 1: 30 }, [state(1, 29)])).toEqual({ next: { 1: 30 }, arrivals: [] });
    expect(advanceNotificationState({ 1: 30 }, [state(1, 31, 0)])).toEqual({ next: { 1: 31 }, arrivals: [] });
  });

  test("un rechargement réutilise le curseur sérialisé et regroupe une rafale par conversation", () => {
    const saved = JSON.parse(JSON.stringify(advanceNotificationState(null, [state(1, 20)]).next));
    const incoming = state(1, 50, 30);
    expect(advanceNotificationState(saved, [incoming]).arrivals).toEqual([incoming]);
  });
});
