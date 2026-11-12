import { jest } from "@jest/globals";

describe("réponse progressive du chatbot", () => {
  const globals = new Map(["window", "sessionStorage", "fetch"]
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let controller;
  let conversation;
  let errorLog;
  const encode = (event) => new TextEncoder().encode(`${JSON.stringify(event)}\n`);

  beforeEach(async () => {
    jest.resetModules();
    const values = new Map();
    globalThis.window = { location: { search: "" } };
    globalThis.sessionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(new ReadableStream({
      start(stream) { controller = stream; },
    }), { headers: { "Content-Type": "application/x-ndjson" } }));
    errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const { createConversationService } = await import("../../../../frontend/public/js/services/conversationService.js");
    conversation = createConversationService({ technicianId: 7 });
  });

  afterEach(() => {
    errorLog.mockRestore();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  test("les morceaux arrivent avant la fin, même avec un caractère UTF-8 coupé", async () => {
    let received;
    const firstDelta = new Promise((resolve) => { received = resolve; });
    const listener = jest.fn();
    conversation.subscribe(listener);
    const deltas = [];
    const pending = conversation.ask("Panne", { onDelta: (text) => { deltas.push(text); received(); } });
    const bytes = encode({ type: "delta", text: "Vérifie " });
    const accent = bytes.indexOf(0xc3);
    controller.enqueue(bytes.slice(0, accent + 1));
    controller.enqueue(bytes.slice(accent + 1));
    await firstDelta;
    expect(deltas).toEqual(["Vérifie "]);
    expect(conversation.messageCount).toBe(1);
    expect(conversation.conversationId).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    controller.enqueue(encode({ type: "delta", text: "le lecteur." }));
    controller.enqueue(encode({ type: "done", response: {
      conversation_id: 31, reply: "Vérifie le lecteur.", solution_proposal_available: true,
    } }));
    controller.close();
    expect(await pending).toMatchObject({ text: "Vérifie le lecteur.", conversationId: 31 });
    expect(deltas.join("")).toBe("Vérifie le lecteur.");
    expect(conversation.messageCount).toBe(2);
    expect(listener.mock.calls[1][0].message).toMatchObject({ role: "assistant", canProposeSolution: true });
    expect(fetch.mock.calls[0][0]).toBe("api/chat/stream");
  });

  test("une erreur après du texte ne sauvegarde pas une réponse partielle", async () => {
    const onDelta = jest.fn();
    const pending = conversation.ask("Panne", { onDelta });
    controller.enqueue(encode({ type: "delta", text: "Provisoire" }));
    controller.enqueue(encode({ type: "error", status: 503, detail: "Réponse interrompue." }));
    controller.close();
    await expect(pending).rejects.toMatchObject({ status: 503 });
    expect(onDelta).toHaveBeenCalledWith("Provisoire");
    expect(conversation.messageCount).toBe(1);
    expect(conversation.conversationId).toBeNull();
  });

  test("une connexion terminée sans événement final est une erreur", async () => {
    const pending = conversation.ask("Panne", { onDelta: jest.fn() });
    controller.enqueue(encode({ type: "delta", text: "Provisoire" }));
    controller.close();
    await expect(pending).rejects.toMatchObject({ kind: "invalid-response" });
    expect(conversation.messageCount).toBe(1);
  });

  test("un échec du stockage local ne publie pas de message final réussi", async () => {
    const listener = jest.fn();
    conversation.subscribe(listener);
    const pending = conversation.ask("Panne", { onDelta: jest.fn() });
    sessionStorage.setItem = () => { throw new Error("Stockage plein"); };
    controller.enqueue(encode({ type: "done", response: { conversation_id: 31, reply: "Complet" } }));
    controller.close();
    await expect(pending).rejects.toThrow("Stockage plein");
    expect(conversation.messageCount).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
