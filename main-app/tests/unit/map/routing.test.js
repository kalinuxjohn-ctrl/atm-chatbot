import { routeRequestSchema } from "../../../src/schemas/map/mapSchemas.js";
import { calculateRoute } from "../../../src/services/map/routingService.js";

const route = {
  start: { latitude: 48.85, longitude: 2.35 },
  end: { latitude: 48.86, longitude: 2.36 },
  mode: "walking",
  preference: "shortest",
};
const feature = {
  geometry: { type: "LineString", coordinates: [[2.35, 48.85], [2.36, 48.86]] },
  properties: { summary: { distance: 1250, duration: 900 } },
};

test.each([
  ["walking", "foot-walking"], ["cycling", "cycling-regular"], ["motorcycle", "driving-car"], ["driving", "driving-car"],
])("routage %s : bon profil, longitude avant latitude, tracé et métriques", async (mode, profile) => {
  const calls = [];
  const result = await calculateRoute({
    apiKey: "test-key",
    route: { ...route, mode },
    fetchFunction: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ features: [feature] });
    },
  });
  expect(calls[0].url).toBe(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`);
  expect(JSON.parse(calls[0].options.body)).toEqual({ coordinates: [[2.35, 48.85], [2.36, 48.86]], preference: "shortest", instructions: false });
  expect(calls[0].options.redirect).toBe("error");
  expect(result.geometry).toEqual(feature.geometry);
  expect(result.distanceMeters).toBe(1250);
  expect(result.durationSeconds).toBe(900);
  expect(result.warning !== null).toBe(mode === "motorcycle");
  expect(JSON.stringify(result)).not.toContain("test-key");
});

test.each([
  { ...route, mode: "../../evil" },
  { ...route, start: { latitude: 91, longitude: 2 } },
  { ...route, end: { latitude: 48, longitude: 181 } },
  { ...route, preference: "unknown" },
  { ...route, start: { latitude: null, longitude: 0 } },
])("refuse une requête invalide", (input) => {
  expect(routeRequestSchema.safeParse(input).success).toBe(false);
});

test("pas de clé : erreur explicite sans appel externe", async () => {
  await expect(calculateRoute({ route })).rejects.toMatchObject({ httpStatus: 503 });
});

test.each([401, 403, 429, 500])("erreur fournisseur %s : échec explicite", async (status) => {
  await expect(calculateRoute({ apiKey: "test", route, fetchFunction: async () => new Response("", { status }) })).rejects.toMatchObject({ httpStatus: 503 });
});

test("aucun itinéraire : 404", async () => {
  await expect(calculateRoute({ apiKey: "test", route, fetchFunction: async () => new Response("", { status: 404 }) })).rejects.toMatchObject({ httpStatus: 404 });
});

test.each([{ features: [] }, { features: [{ ...feature, geometry: { type: "Polygon", coordinates: [] } }] }])("tracé absent ou incorrect : pas de faux succès", async (data) => {
  await expect(calculateRoute({ apiKey: "test", route, fetchFunction: async () => Response.json(data) })).rejects.toMatchObject({ httpStatus: 503 });
});

test("panne réseau : 503", async () => {
  await expect(calculateRoute({ apiKey: "test", route, fetchFunction: async () => { throw new TypeError("network"); } })).rejects.toMatchObject({ httpStatus: 503 });
});

test("réponse trop volumineuse : 503", async () => {
  await expect(calculateRoute({ apiKey: "test", route, fetchFunction: async () => new Response("x".repeat(2 * 1024 * 1024 + 1)) })).rejects.toMatchObject({ httpStatus: 503 });
});
