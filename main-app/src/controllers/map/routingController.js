import { parseWithSchema } from "../../core/validation.js";
import { routeRequestSchema } from "../../schemas/map/mapSchemas.js";
import { calculateRoute } from "../../services/map/routingService.js";

export async function readRoute(request, response) {
  const route = parseWithSchema(routeRequestSchema, request.body);
  const { MAIN_APP_MAP_ROUTING_API_KEY } = request.app.locals.configuration;
  response.set("Cache-Control", "no-store");
  response.json(await calculateRoute({ apiKey: MAIN_APP_MAP_ROUTING_API_KEY, route }));
}
