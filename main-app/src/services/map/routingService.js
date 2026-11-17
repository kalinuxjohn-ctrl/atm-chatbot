import { z } from "zod";
import { ExternalServiceUnavailableError, ReferenceNotFoundError } from "../../core/errors.js";
import { trace } from "../../core/tracing.js";
import { routeRequestSchema } from "../../schemas/map/mapSchemas.js";

const PROFILES = { walking: "foot-walking", cycling: "cycling-regular", motorcycle: "driving-car", driving: "driving-car" };
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const routeFeatureSchema = z.object({
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2).max(100_000),
  }),
  properties: z.object({
    summary: z.object({ distance: z.number().nonnegative(), duration: z.number().nonnegative() }),
  }),
});

export async function calculateRoute({ apiKey, route, fetchFunction = fetch }) {
  const { start, end, mode, preference } = routeRequestSchema.parse(route);
  if (!apiKey) {
    throw new ExternalServiceUnavailableError("Itinéraires non configurés : renseignez la clé OpenRouteService côté serveur.");
  }
  let response;
  let bytes;
  try {
    response = await fetchFunction(`https://api.openrouteservice.org/v2/directions/${PROFILES[mode]}/geojson`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/geo+json" },
      body: JSON.stringify({
        coordinates: [[start.longitude, start.latitude], [end.longitude, end.latitude]],
        preference,
        instructions: false,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) {
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAXIMUM_RESPONSE_BYTES) {
          throw new RangeError("Routing response exceeds maximum size");
        }
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks).toString("utf8");
    }
  } catch (error) {
    trace("MAP", "Service d'itinéraires injoignable ou réponse trop volumineuse", { errorName: error.name });
    throw new ExternalServiceUnavailableError("Calcul d'itinéraire momentanément indisponible. Réessayez.");
  }
  if (!response.ok) {
    trace("MAP", "Service d'itinéraires en échec", { status: response.status });
    if (response.status === 404) throw new ReferenceNotFoundError("Aucun itinéraire trouvé pour ces positions et ce mode.");
    throw new ExternalServiceUnavailableError(
      response.status === 429 ? "Quota d'itinéraires atteint. Réessayez plus tard." : "Le service d'itinéraires a refusé la demande. Vérifiez sa configuration.",
    );
  }
  let parsed;
  try {
    parsed = routeFeatureSchema.safeParse(JSON.parse(bytes)?.features?.[0]);
  } catch (error) {
    trace("MAP", "Réponse d'itinéraire illisible", { errorName: error.name });
    throw new ExternalServiceUnavailableError("Réponse du service d'itinéraires invalide.");
  }
  if (!parsed.success) {
    trace("MAP", "Réponse d'itinéraire non conforme");
    throw new ExternalServiceUnavailableError("Aucun tracé exploitable reçu du service d'itinéraires.");
  }
  return {
    geometry: parsed.data.geometry,
    distanceMeters: parsed.data.properties.summary.distance,
    durationSeconds: parsed.data.properties.summary.duration,
    mode,
    preference,
    attribution: "© openrouteservice.org by HeiGIT | © OpenStreetMap contributors",
    warning: mode === "motorcycle" ? "Moto : profil voiture, sans restrictions spécifiques aux motos." : null,
  };
}
