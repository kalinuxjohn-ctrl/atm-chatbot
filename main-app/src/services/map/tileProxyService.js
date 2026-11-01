/**
 * Relais des tuiles de la carte : le navigateur demande /api/map/tiles/z/x/y
 * à NOTRE serveur, qui va chercher la tuile chez le fournisseur.
 *
 * Pourquoi un relais :
 * - aucune clé d'API dans le frontend (si le fournisseur en exige une, elle
 *   est dans le gabarit d'URL de .env, côté serveur) ;
 * - pas de SSRF : l'hôte appelé est FIXÉ par MAIN_APP_MAP_TILE_URL_TEMPLATE,
 *   le client ne fournit que trois entiers validés (z, x, y) ;
 * - cache : une tuile déjà demandée n'est pas redemandée au fournisseur
 *   (règle d'usage d'OpenStreetMap : pas de téléchargements répétés).
 * - la CSP reste stricte (img-src / connect-src 'self').
 */

import { ExternalServiceUnavailableError, ReferenceNotFoundError } from "../../core/errors.js";
import { trace } from "../../core/tracing.js";

const TILE_CACHE_DURATION_MILLISECONDS = 24 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MILLISECONDS = 8_000;
const MAXIMUM_TILE_BYTES = 1024 * 1024;
const ALLOWED_TILE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Cache en mémoire, du plus ancien au plus récemment lu (ordre d'insertion
 * d'une Map) : au-delà de `maximumEntries`, la tuile la moins récemment lue
 * est oubliée. En mémoire et non sur disque : le conteneur est en lecture seule.
 */
export function createTileProxy({ urlTemplate, userAgent, maximumEntries, fetchFunction = fetch }) {
  const cachedTilesByKey = new Map();

  function readFromCache(tileKey) {
    const cachedTile = cachedTilesByKey.get(tileKey);
    if (!cachedTile) {
      return null;
    }
    cachedTilesByKey.delete(tileKey);
    if (cachedTile.expiresAt < Date.now()) {
      return null;
    }
    cachedTilesByKey.set(tileKey, cachedTile); // remis en dernière position = récemment lu
    return cachedTile;
  }

  function storeInCache(tileKey, tile) {
    cachedTilesByKey.set(tileKey, { ...tile, expiresAt: Date.now() + TILE_CACHE_DURATION_MILLISECONDS });
    while (cachedTilesByKey.size > maximumEntries) {
      cachedTilesByKey.delete(cachedTilesByKey.keys().next().value);
    }
  }

  async function downloadTile({ z, x, y }) {
    // Remplacement par des entiers déjà validés : rien d'autre ne peut entrer dans l'URL.
    const providerUrl = urlTemplate.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    let providerResponse;
    try {
      providerResponse = await fetchFunction(providerUrl, {
        headers: { "User-Agent": userAgent, Accept: "image/png,image/jpeg,image/webp" },
        redirect: "error", // une redirection pourrait mener vers un autre hôte
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MILLISECONDS),
      });
    } catch (error) {
      trace("MAP", "Fournisseur de tuiles injoignable", { errorName: error.name });
      throw new ExternalServiceUnavailableError("Fond de carte momentanément indisponible.");
    }

    if (providerResponse.status === 404) {
      throw new ReferenceNotFoundError("Tuile inexistante.");
    }
    const mediaType = (providerResponse.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!providerResponse.ok || !ALLOWED_TILE_MEDIA_TYPES.has(mediaType)) {
      trace("MAP", "Réponse inattendue du fournisseur de tuiles", { status: providerResponse.status, mediaType });
      throw new ExternalServiceUnavailableError("Fond de carte momentanément indisponible.");
    }
    const tileBytes = Buffer.from(await providerResponse.arrayBuffer());
    if (tileBytes.length > MAXIMUM_TILE_BYTES) {
      throw new ExternalServiceUnavailableError("Fond de carte momentanément indisponible.");
    }
    return { mediaType, tileBytes };
  }

  return {
    async findTile(tileCoordinates) {
      const tileKey = `${tileCoordinates.z}/${tileCoordinates.x}/${tileCoordinates.y}`;
      const cachedTile = readFromCache(tileKey);
      if (cachedTile) {
        return { mediaType: cachedTile.mediaType, tileBytes: cachedTile.tileBytes, servedFromCache: true };
      }
      const downloadedTile = await downloadTile(tileCoordinates);
      storeInCache(tileKey, downloadedTile);
      return { ...downloadedTile, servedFromCache: false };
    },
  };
}
