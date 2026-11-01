/**
 * Relais des tuiles : seules des coordonnées valides atteignent le
 * fournisseur, dont l'hôte est fixé par la configuration (pas de SSRF), et
 * une tuile déjà téléchargée sort du cache.
 */

import { createTileCoordinatesSchema } from "../../../src/schemas/map/mapSchemas.js";
import { createTileProxy } from "../../../src/services/map/tileProxyService.js";

const PROVIDER_TEMPLATE = "https://tiles.example.test/{z}/{x}/{y}.png";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createFakeProvider({ status = 200, contentType = "image/png" } = {}) {
  const requestedUrls = [];
  async function fakeFetch(url) {
    requestedUrls.push(url);
    return new Response(PNG_SIGNATURE, { status, headers: { "Content-Type": contentType } });
  }
  return { fakeFetch, requestedUrls };
}

describe("coordonnées de tuile", () => {
  const tileCoordinatesSchema = createTileCoordinatesSchema(19);

  test.each([
    [{ z: "0", x: "0", y: "0" }, true],
    [{ z: "3", x: "7", y: "7" }, true],
    [{ z: "3", x: "8", y: "0" }, false], // hors de la grille 8x8 du niveau 3
    [{ z: "20", x: "0", y: "0" }, false], // zoom trop grand
    [{ z: "1", x: "-1", y: "0" }, false],
    [{ z: "1", x: "0", y: "0.png" }, false],
    [{ z: "1", x: "../../etc", y: "0" }, false],
    [{ z: "1", x: "0@evil.test", y: "0" }, false],
  ])("%j -> valide : %s", (tileParameters, isValid) => {
    expect(tileCoordinatesSchema.safeParse(tileParameters).success).toBe(isValid);
  });
});

describe("relais des tuiles", () => {
  test("appelle uniquement l'hôte configuré, puis sert la tuile depuis le cache", async () => {
    const { fakeFetch, requestedUrls } = createFakeProvider();
    const tileProxy = createTileProxy({ urlTemplate: PROVIDER_TEMPLATE, userAgent: "tests", maximumEntries: 10, fetchFunction: fakeFetch });

    const firstTile = await tileProxy.findTile({ z: 2, x: 1, y: 3 });
    const secondTile = await tileProxy.findTile({ z: 2, x: 1, y: 3 });
    expect(requestedUrls).toEqual(["https://tiles.example.test/2/1/3.png"]);
    expect(firstTile.servedFromCache).toBe(false);
    expect(secondTile.servedFromCache).toBe(true);
    expect(secondTile.mediaType).toBe("image/png");
  });

  test("le cache oublie les tuiles les moins récemment lues au-delà de sa taille", async () => {
    const { fakeFetch, requestedUrls } = createFakeProvider();
    const tileProxy = createTileProxy({ urlTemplate: PROVIDER_TEMPLATE, userAgent: "tests", maximumEntries: 2, fetchFunction: fakeFetch });
    await tileProxy.findTile({ z: 1, x: 0, y: 0 });
    await tileProxy.findTile({ z: 1, x: 0, y: 1 });
    await tileProxy.findTile({ z: 1, x: 1, y: 0 }); // chasse 1/0/0
    await tileProxy.findTile({ z: 1, x: 0, y: 0 });
    expect(requestedUrls).toHaveLength(4);
  });

  test("une réponse qui n'est pas une image n'est jamais relayée", async () => {
    const { fakeFetch } = createFakeProvider({ contentType: "text/html" });
    const tileProxy = createTileProxy({ urlTemplate: PROVIDER_TEMPLATE, userAgent: "tests", maximumEntries: 10, fetchFunction: fakeFetch });
    await expect(tileProxy.findTile({ z: 0, x: 0, y: 0 })).rejects.toMatchObject({ httpStatus: 503 });
  });

  test("fournisseur injoignable : 503", async () => {
    const tileProxy = createTileProxy({
      urlTemplate: PROVIDER_TEMPLATE,
      userAgent: "tests",
      maximumEntries: 10,
      fetchFunction: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(tileProxy.findTile({ z: 0, x: 0, y: 0 })).rejects.toMatchObject({ httpStatus: 503 });
  });
});
