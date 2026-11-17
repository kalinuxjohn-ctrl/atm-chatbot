import { jest } from "@jest/globals";

describe("historique durable du chatbot", () => {
  const savedGlobals = new Map(["window", "sessionStorage", "fetch"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let api;
  let values;

  beforeEach(async () => {
    jest.resetModules();
    values = new Map();
    globalThis.window = { location: { search: "" } };
    globalThis.sessionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    globalThis.fetch = jest.fn();
    api = await import("../../../../frontend/public/js/services/api/conversationApi.js");
  });

  afterEach(() => {
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  test("le cache actif est isolé par technicien et le reset ne supprime pas la base", async () => {
    await api.saveConversation({ conversationId: 31, messages: [{ text: "prive" }] }, 7);
    expect((await api.loadConversation(7)).conversationId).toBe(31);
    expect((await api.loadConversation(8)).messages).toEqual([]);
    await api.clearConversation(7);
    expect((await api.loadConversation(7)).conversationId).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("la liste charge les pages du serveur pour le compte courant", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [], has_more: false }) });
    await api.listConversations(7, 30);
    expect(fetch.mock.calls[0][0]).toBe("api/chat/conversations?technician_id=7&offset=30");
  });

  test("reprendre une conversation restaure le type et les messages complets", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({
      conversation_id: 31, device_type: "tpe",
      messages: [
        { role: "user", content: "Panne", created_at: "2026-11-11T12:00:00Z" },
        { role: "assistant", content: "Controle", created_at: "2026-11-11T12:01:00Z" },
      ],
    }) });
    const history = await api.readConversation(31, 7);
    expect(history).toMatchObject({
      conversationId: 31, deviceType: "tpe",
      messages: [{ role: "user", text: "Panne" }, { role: "assistant", text: "Controle" }],
    });
    expect(fetch.mock.calls[0][0]).toBe("api/chat/conversations/31?technician_id=7");
  });

  test("un refus serveur ne remplace pas la conversation active", async () => {
    const { createConversationService } = await import("../../../../frontend/public/js/services/conversationService.js");
    const conversation = createConversationService({ technicianId: 7 });
    await api.saveConversation({ conversationId: 31, deviceType: "gab", messages: [] }, 7);
    await conversation.restore();
    fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: "Conversation introuvable." }) });
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(conversation.open(99)).rejects.toThrow();
    expect(conversation.conversationId).toBe(31);
    errorLog.mockRestore();
  });

  test("la reprise emet restored et la prochaine question garde le meme contexte", async () => {
    const { createConversationService } = await import("../../../../frontend/public/js/services/conversationService.js");
    const conversation = createConversationService({ technicianId: 7 });
    const listener = jest.fn();
    conversation.subscribe(listener);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      conversation_id: 31, device_type: "tpe",
      messages: [{ role: "user", content: "Panne", created_at: "2026-11-11T12:00:00Z" }],
    }) });
    await conversation.open(31);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "restored" }));
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ conversation_id: 31, reply: "Suite" }) });
    await conversation.ask("Et ensuite ?");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      technician_id: 7, conversation_id: 31, device_type: "tpe", message: "Et ensuite ?",
    });
  });

  test("un stockage sature ne remplace pas silencieusement l'etat actif", async () => {
    const { createConversationService } = await import("../../../../frontend/public/js/services/conversationService.js");
    const conversation = createConversationService({ technicianId: 7 });
    await api.saveConversation({ conversationId: 31, deviceType: "gab", messages: [] }, 7);
    await conversation.restore();
    fetch.mockResolvedValue({ ok: true, json: async () => ({
      conversation_id: 32, device_type: "tpe", messages: [],
    }) });
    sessionStorage.setItem = () => { throw new Error("Quota exceeded"); };
    await expect(conversation.open(32)).rejects.toThrow("Quota exceeded");
    expect(conversation.conversationId).toBe(31);
  });

  test("un choix de code enregistre l'echange et garde le contexte serveur sans requete Claude", async () => {
    const { createConversationService } = await import("../../../../frontend/public/js/services/conversationService.js");
    const conversation = createConversationService({ technicianId: 7 });
    const listener = jest.fn();
    conversation.subscribe(listener);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      conversation_id: 44, reply: "Consigne du catalogue", detected_error_code: "01", error_code_id: 1001,
    }) });
    expect(await conversation.selectErrorCode(1001)).toBe("Consigne du catalogue");
    expect(conversation.conversationId).toBe(44);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("api/chat/error-code");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      conversation_id: null, technician_id: 7, device_type: "gab", error_code_id: 1001,
    });
    expect(listener.mock.calls.map(([event]) => event.message)).toMatchObject([
      { role: "user", text: "Code erreur 01", detectedErrorCode: "01", errorCodeId: 1001 },
      { role: "assistant", text: "Consigne du catalogue", detectedErrorCode: "01", errorCodeId: 1001 },
    ]);
  });

  test("une reference de code est restauree depuis l'historique durable", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({
      conversation_id: 44, device_type: "gab", messages: [{
        role: "assistant", content: "Consigne", created_at: "2026-11-12T10:00:00Z",
        detected_error_code: "01", error_code_id: 1001,
      }],
    }) });
    const history = await api.readConversation(44, 7);
    expect(history.messages[0]).toMatchObject({ detectedErrorCode: "01", errorCodeId: 1001 });
  });
});
