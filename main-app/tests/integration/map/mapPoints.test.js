/**
 * Droits sur les points de la carte, recherche par zone et par proximité.
 */

import { loadConfiguration } from "../../../src/core/config.js";
import { createFeatureApp } from "../../../src/core/createFeatureApp.js";
import { createMapRouter } from "../../../src/routes/map/mapRoutes.js";
import { connectToTestDatabase, createAccountWithSession, describeWithDatabase, sendAs } from "../integrationTestHelpers.js";

// Lieux de test réels : deux GAB à Paris (~1 km d'écart) et un à Lyon (~390 km).
const PARIS_OPERA = { latitude: 48.8719, longitude: 2.3316 };
const PARIS_LOUVRE = { latitude: 48.8606, longitude: 2.3376 };
const LYON_BELLECOUR = { latitude: 45.7578, longitude: 4.832 };

function createMapApp() {
  return createFeatureApp({ featureName: "map", configuration: loadConfiguration("map"), apiRouter: createMapRouter() });
}

async function createPoint(mapApp, account, coordinates, title = "GAB de test") {
  const creationResponse = await sendAs(mapApp, account)
    .post("/api/map/points")
    .send({ title, category: "atm_site", description: "Accès par la cour", ...coordinates });
  expect(creationResponse.status).toBe(201);
  return creationResponse.body.point;
}

describeWithDatabase("points de la carte", () => {
  connectToTestDatabase();
  const mapApp = createMapApp();

  test("sans session : 401, y compris pour les tuiles", async () => {
    expect((await sendAs(mapApp, null).get("/api/map/points?south=0&west=0&north=1&east=1")).status).toBe(401);
    expect((await sendAs(mapApp, null).get("/api/map/tiles/1/0/0")).status).toBe(401);
  });

  test("un technicien modifie et supprime SES points, pas ceux des autres", async () => {
    const author = await createAccountWithSession();
    const colleague = await createAccountWithSession();
    const point = await createPoint(mapApp, author, PARIS_OPERA);
    expect(point.canModify).toBe(true);

    const seenByColleague = await sendAs(mapApp, colleague).get(`/api/map/points/${point.id}`);
    expect(seenByColleague.status).toBe(200);
    expect(seenByColleague.body.point.canModify).toBe(false);

    expect((await sendAs(mapApp, colleague).patch(`/api/map/points/${point.id}`).send({ title: "Piraté" })).status).toBe(403);
    expect((await sendAs(mapApp, colleague).delete(`/api/map/points/${point.id}`)).status).toBe(403);

    const authorUpdate = await sendAs(mapApp, author).patch(`/api/map/points/${point.id}`).send({ title: "GAB Opéra" });
    expect(authorUpdate.status).toBe(200);
    expect(authorUpdate.body.point.title).toBe("GAB Opéra");
    expect((await sendAs(mapApp, author).delete(`/api/map/points/${point.id}`)).status).toBe(204);
    expect((await sendAs(mapApp, author).get(`/api/map/points/${point.id}`)).status).toBe(404);
  });

  test.each(["moderator", "admin"])("un %s gère tous les points", async (role) => {
    const author = await createAccountWithSession();
    const manager = await createAccountWithSession({ role });
    const point = await createPoint(mapApp, author, PARIS_LOUVRE);
    expect((await sendAs(mapApp, manager).patch(`/api/map/points/${point.id}`).send({ category: "difficult_access" })).status).toBe(200);
    expect((await sendAs(mapApp, manager).delete(`/api/map/points/${point.id}`)).status).toBe(204);
  });

  test("le titre est gardé comme TEXTE brut (balises et emojis inclus)", async () => {
    const author = await createAccountWithSession();
    const point = await createPoint(mapApp, author, PARIS_OPERA, "<img src=x onerror=alert(1)> GAB 🏧");
    expect(point.title).toBe("<img src=x onerror=alert(1)> GAB 🏧");
  });

  test("coordonnées et contenu invalides : 422", async () => {
    const author = await createAccountWithSession();
    const invalidPoints = [
      { title: "Trop au nord", latitude: 91, longitude: 0 },
      { title: "Trop à l'est", latitude: 0, longitude: 181 },
      { title: "", latitude: 0, longitude: 0 },
      { title: "Contrôle\u0007", latitude: 0, longitude: 0 },
      { title: "x".repeat(121), latitude: 0, longitude: 0 },
      { title: "Catégorie inconnue", category: "secret", latitude: 0, longitude: 0 },
    ];
    for (const invalidPoint of invalidPoints) {
      expect((await sendAs(mapApp, author).post("/api/map/points").send(invalidPoint)).status).toBe(422);
    }
    expect((await sendAs(mapApp, author).get("/api/map/points/not-a-uuid")).status).toBe(422);
  });

  test("zone visible (bbox) et proximité (earthdistance)", async () => {
    const author = await createAccountWithSession();
    const opera = await createPoint(mapApp, author, PARIS_OPERA, "Opéra");
    const louvre = await createPoint(mapApp, author, PARIS_LOUVRE, "Louvre");
    const lyon = await createPoint(mapApp, author, LYON_BELLECOUR, "Bellecour");

    const parisBox = await sendAs(mapApp, author).get("/api/map/points?south=48.8&west=2.2&north=48.95&east=2.45");
    const parisIds = parisBox.body.points.map((point) => point.id);
    expect(parisIds).toEqual(expect.arrayContaining([opera.id, louvre.id]));
    expect(parisIds).not.toContain(lyon.id);

    const nearOpera = await sendAs(mapApp, author).get(`/api/map/points/nearby?lat=${PARIS_OPERA.latitude}&lng=${PARIS_OPERA.longitude}&radius=2000`);
    expect(nearOpera.status).toBe(200);
    const nearbyIds = nearOpera.body.points.map((point) => point.id);
    expect(nearbyIds).toEqual(expect.arrayContaining([opera.id, louvre.id]));
    expect(nearbyIds).not.toContain(lyon.id);
    const louvreDistance = nearOpera.body.points.find((point) => point.id === louvre.id).distanceMeters;
    expect(louvreDistance).toBeGreaterThan(1000);
    expect(louvreDistance).toBeLessThan(1500);

    expect((await sendAs(mapApp, author).get("/api/map/points/nearby?lat=48&lng=2&radius=999999")).status).toBe(422);
    expect((await sendAs(mapApp, author).get("/api/map/points?south=50&west=0&north=40&east=1")).status).toBe(422);
  });
});
