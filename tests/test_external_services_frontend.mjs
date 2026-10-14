import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

globalThis.window = { location: { search: "" } };
globalThis.sessionStorage = { getItem: () => null };
const { ApiRequestError, getFriendlyErrorMessage, postJson } = await import("../frontend/public/js/core/httpClient.js");
const { searchSymptoms } = await import("../frontend/public/js/services/api/symptomApi.js");

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("HTTP failures reject instead of returning a successful payload", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Service indisponible." }), { status: 503 });
  await assert.rejects(postJson("/chat", {}), (error) =>
    error instanceof ApiRequestError && error.status === 503 && error.kind === "server");
});

test("provider errors inside legacy summaries reject instead of hiding the summary", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    solutions: [], matched_symptom_ids: [], summary: "Impossible de joindre le service.",
  }));
  await assert.rejects(searchSymptoms("VPN KO", "gab"), (error) =>
    error instanceof ApiRequestError && error.status === 503);
});

test("successful search responses keep their existing shape", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    solutions: [], matched_symptom_ids: [], summary: " Aucun résultat. ",
  }));
  assert.deepEqual(await searchSymptoms("VPN KO", "gab"), {
    solutions: [], matchedSymptomIds: [], summary: "Aucun résultat.", summaryUnavailable: false,
  });
});

test("post-commit failures show the warning not to submit the write again", () => {
  const detail = "La donnée a été enregistrée. Ne répétez pas l'enregistrement.";
  assert.equal(getFriendlyErrorMessage(new ApiRequestError("conflict", { status: 409, detail })), detail);
});

test("database unavailability is not mislabeled as an AI quota problem", () => {
  const detail = "Le service de données est momentanément indisponible.";
  assert.equal(getFriendlyErrorMessage(new ApiRequestError("unavailable", { status: 503, detail })), detail);
});
