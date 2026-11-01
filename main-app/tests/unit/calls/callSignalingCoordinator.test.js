/**
 * Règles des appels, sans réseau : occupé, sonnerie de 30 s, seul l'appelé
 * répond, relais réservé aux deux onglets engagés, journal écrit à la fin.
 */

import { jest } from "@jest/globals";

import { createCallSignalingCoordinator } from "../../../src/services/calls/callSignalingCoordinator.js";

const ACCOUNTS = {
  1: { technicianId: 1, username: "alan" },
  2: { technicianId: 2, username: "bob" },
  3: { technicianId: 3, username: "carla" },
};

function createFakeConnection(technicianId) {
  const receivedMessages = [];
  return {
    technicianId,
    username: ACCOUNTS[technicianId].username,
    receivedMessages,
    sendMessage: (message) => receivedMessages.push(message),
    lastMessageOfType: (type) => receivedMessages.filter((message) => message.type === type).at(-1),
  };
}

function createTestCoordinator() {
  const recordedCallLogs = [];
  const coordinator = createCallSignalingCoordinator({
    findCallableAccount: async (technicianId) => ACCOUNTS[technicianId] ?? null,
    recordCallLog: async (callLog) => recordedCallLogs.push(callLog),
    ringTimeoutMilliseconds: 30_000,
  });
  return { coordinator, recordedCallLogs };
}

async function startRingingCall(coordinator, callerConnection, calleeConnection) {
  await coordinator.handleClientMessage(callerConnection, { type: "call.start", calleeTechnicianId: calleeConnection.technicianId });
  return calleeConnection.lastMessageOfType("call.incoming").callId;
}

describe("coordination des appels", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("appel décroché puis raccroché : journal « answered »", async () => {
    const { coordinator, recordedCallLogs } = createTestCoordinator();
    const alan = createFakeConnection(1);
    const bob = createFakeConnection(2);
    coordinator.connectionOpened(alan);
    coordinator.connectionOpened(bob);

    const callId = await startRingingCall(coordinator, alan, bob);
    expect(alan.lastMessageOfType("call.ringing")).toMatchObject({ callId, callee: { username: "bob" } });
    expect(bob.lastMessageOfType("call.incoming").caller).toEqual({ technicianId: 1, username: "alan" });

    await coordinator.handleClientMessage(bob, { type: "call.accept", callId });
    expect(alan.lastMessageOfType("call.accepted")).toEqual({ type: "call.accepted", callId });

    await coordinator.handleClientMessage(alan, { type: "call.hang-up", callId });
    expect(bob.lastMessageOfType("call.ended")).toMatchObject({ callId, reason: "hung_up" });
    await Promise.resolve();
    expect(recordedCallLogs).toEqual([expect.objectContaining({ callId, status: "answered", callerTechnicianId: 1, calleeTechnicianId: 2 })]);
    expect(recordedCallLogs[0].answeredAt).toBeInstanceOf(Date);
  });

  test("sans réponse en 30 s : « manqué »", async () => {
    const { coordinator, recordedCallLogs } = createTestCoordinator();
    const alan = createFakeConnection(1);
    const bob = createFakeConnection(2);
    coordinator.connectionOpened(alan);
    coordinator.connectionOpened(bob);
    const callId = await startRingingCall(coordinator, alan, bob);

    jest.advanceTimersByTime(29_999);
    expect(alan.lastMessageOfType("call.ended")).toBeUndefined();
    jest.advanceTimersByTime(1);
    expect(alan.lastMessageOfType("call.ended")).toMatchObject({ callId, reason: "no_answer" });
    await Promise.resolve();
    expect(recordedCallLogs[0]).toMatchObject({ status: "missed", endReason: "no_answer" });
  });

  test("un seul appel par utilisateur : le troisième reçoit « occupé »", async () => {
    const { coordinator, recordedCallLogs } = createTestCoordinator();
    const alan = createFakeConnection(1);
    const bob = createFakeConnection(2);
    const carla = createFakeConnection(3);
    [alan, bob, carla].forEach((connection) => coordinator.connectionOpened(connection));
    await startRingingCall(coordinator, alan, bob);

    await coordinator.handleClientMessage(carla, { type: "call.start", calleeTechnicianId: 2 });
    expect(carla.lastMessageOfType("call.ended")).toMatchObject({ reason: "busy" });
    expect(bob.receivedMessages.filter((message) => message.type === "call.incoming")).toHaveLength(1);

    await coordinator.handleClientMessage(alan, { type: "call.start", calleeTechnicianId: 3 });
    expect(alan.lastMessageOfType("error")).toMatchObject({ code: "already_in_call" });
    await Promise.resolve();
    expect(recordedCallLogs).toEqual([expect.objectContaining({ status: "failed", endReason: "busy", callerTechnicianId: 3 })]);
  });

  test("appelé hors ligne, soi-même, inconnu : l'appel ne sonne pas", async () => {
    const { coordinator } = createTestCoordinator();
    const alan = createFakeConnection(1);
    coordinator.connectionOpened(alan);
    await coordinator.handleClientMessage(alan, { type: "call.start", calleeTechnicianId: 2 });
    expect(alan.lastMessageOfType("call.ended")).toMatchObject({ reason: "callee_offline" });
    await coordinator.handleClientMessage(alan, { type: "call.start", calleeTechnicianId: 1 });
    expect(alan.lastMessageOfType("error")).toMatchObject({ code: "invalid_callee" });
    await coordinator.handleClientMessage(alan, { type: "call.start", calleeTechnicianId: 99 });
    expect(alan.lastMessageOfType("error")).toMatchObject({ code: "callee_not_found" });
  });

  test("seul l'appelé peut répondre ou refuser", async () => {
    const { coordinator, recordedCallLogs } = createTestCoordinator();
    const alan = createFakeConnection(1);
    const bob = createFakeConnection(2);
    const carla = createFakeConnection(3);
    [alan, bob, carla].forEach((connection) => coordinator.connectionOpened(connection));
    const callId = await startRingingCall(coordinator, alan, bob);

    await coordinator.handleClientMessage(alan, { type: "call.accept", callId });
    await coordinator.handleClientMessage(carla, { type: "call.accept", callId });
    await coordinator.handleClientMessage(carla, { type: "call.decline", callId });
    expect(alan.lastMessageOfType("error")).toMatchObject({ code: "cannot_accept" });
    expect(carla.lastMessageOfType("error")).toMatchObject({ code: "cannot_decline" });
    expect(alan.lastMessageOfType("call.accepted")).toBeUndefined();

    await coordinator.handleClientMessage(bob, { type: "call.decline", callId });
    expect(alan.lastMessageOfType("call.ended")).toMatchObject({ reason: "declined" });
    await Promise.resolve();
    expect(recordedCallLogs[0].status).toBe("declined");
  });

  test("relais WebRTC : uniquement entre les deux onglets engagés", async () => {
    const { coordinator } = createTestCoordinator();
    const alan = createFakeConnection(1);
    const bobPhone = createFakeConnection(2);
    const bobLaptop = createFakeConnection(2);
    const carla = createFakeConnection(3);
    [alan, bobPhone, bobLaptop, carla].forEach((connection) => coordinator.connectionOpened(connection));
    const callId = await startRingingCall(coordinator, alan, bobPhone);
    const offer = { type: "call.offer", callId, sessionDescription: { type: "offer", sdp: "v=0..." } };

    // Avant le décroché : pas de relais.
    await coordinator.handleClientMessage(alan, offer);
    expect(alan.lastMessageOfType("error")).toMatchObject({ code: "no_active_call" });

    await coordinator.handleClientMessage(bobPhone, { type: "call.accept", callId });
    expect(bobLaptop.lastMessageOfType("call.taken-elsewhere")).toEqual({ type: "call.taken-elsewhere", callId });

    await coordinator.handleClientMessage(alan, offer);
    expect(bobPhone.lastMessageOfType("call.offer")).toEqual(offer);
    expect(bobLaptop.lastMessageOfType("call.offer")).toBeUndefined();

    // Un tiers, ou l'autre onglet de Bob, ne peut pas injecter de signalisation.
    await coordinator.handleClientMessage(carla, { type: "call.ice-candidate", callId, iceCandidate: { candidate: "x" } });
    expect(carla.lastMessageOfType("error")).toMatchObject({ code: "no_active_call" });
    await coordinator.handleClientMessage(bobLaptop, { type: "call.answer", callId, sessionDescription: { type: "answer", sdp: "v=0" } });
    expect(bobLaptop.lastMessageOfType("error")).toMatchObject({ code: "not_call_connection" });
    expect(alan.lastMessageOfType("call.answer")).toBeUndefined();
  });

  test("changement de page de l'appelé : l'appel continue de sonner et lui est renvoyé", async () => {
    const { coordinator } = createTestCoordinator();
    const alan = createFakeConnection(1);
    const bobHomePage = createFakeConnection(2);
    coordinator.connectionOpened(alan);
    coordinator.connectionOpened(bobHomePage);
    const callId = await startRingingCall(coordinator, alan, bobHomePage);

    coordinator.connectionClosed(bobHomePage);
    expect(alan.lastMessageOfType("call.ended")).toBeUndefined();
    const bobCallsPage = createFakeConnection(2);
    coordinator.connectionOpened(bobCallsPage);
    expect(bobCallsPage.lastMessageOfType("call.incoming")).toMatchObject({ callId });
  });

  test("l'appelant ferme sa page : appel annulé côté appelé", async () => {
    const { coordinator } = createTestCoordinator();
    const alan = createFakeConnection(1);
    const bob = createFakeConnection(2);
    coordinator.connectionOpened(alan);
    coordinator.connectionOpened(bob);
    const callId = await startRingingCall(coordinator, alan, bob);
    coordinator.connectionClosed(alan);
    expect(bob.lastMessageOfType("call.ended")).toMatchObject({ callId, reason: "caller_cancelled" });
    expect(coordinator.isTechnicianOnline(1)).toBe(false);
  });
});
