/**
 * Configuration lue dans les variables d'environnement, validée AU DÉMARRAGE.
 *
 * Chaque conteneur ne reçoit que les variables dont il a besoin
 * (docker-compose.main-app.yml) : il demande donc seulement sa section.
 * Une variable manquante ou invalide arrête le conteneur avec un message
 * explicite, plutôt qu'une panne obscure à la première requête.
 *
 * Aucun secret n'a de valeur par défaut ici : tout vient de `.env`.
 * (zod 4 : la valeur de .default() est la valeur FINALE, déjà convertie.)
 */

import { z } from "zod";

const booleanFromText = z
  .enum(["true", "false"], { error: "doit valoir true ou false" })
  .transform((text) => text === "true");

const positiveIntegerFromText = z.coerce.number().int().positive();

const iceServersSchema = z
  .array(
    z.object({
      urls: z.union([z.string().regex(/^(stun|turns?):/), z.array(z.string().regex(/^(stun|turns?):/)).min(1)]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  )
  .min(1);

const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

/** Commun à tous les conteneurs : base de données, port, cookie de session. */
const sharedConfigurationSchema = z.object({
  MAIN_APP_ENVIRONMENT: z.enum(["production", "development", "test"]).default("production"),
  MAIN_APP_PORT: positiveIntegerFromText.default(3000),
  MAIN_APP_DATABASE_HOST: z.string().min(1),
  MAIN_APP_DATABASE_PORT: positiveIntegerFromText.default(5432),
  MAIN_APP_DATABASE_NAME: z.string().min(1),
  MAIN_APP_DATABASE_USER: z.string().min(1),
  MAIN_APP_DATABASE_PASSWORD: z.string().min(1),
  MAIN_APP_COOKIE_SECURE: booleanFromText.default(true),
  MAIN_APP_SESSION_DURATION_HOURS: positiveIntegerFromText.max(24 * 30).default(12),
});

/** Variables propres à chaque fonctionnalité, en plus des variables communes. */
const featureConfigurationSchemas = {
  auth: z.object({
    MAIN_APP_ALLOW_REGISTRATION: booleanFromText.default(false),
    MAIN_APP_LOGIN_MAX_FAILED_ATTEMPTS: positiveIntegerFromText.max(100).default(5),
    MAIN_APP_LOGIN_LOCK_MINUTES: positiveIntegerFromText.max(24 * 60).default(15),
  }),
  map: z.object({
    // Gabarit FIXE du fournisseur de tuiles, ex. https://tile.openstreetmap.org/{z}/{x}/{y}.png.
    // Le client n'envoie que z/x/y validés : il ne peut jamais choisir l'hôte appelé (pas de SSRF).
    MAIN_APP_MAP_TILE_URL_TEMPLATE: z
      .string()
      .refine((template) => template.startsWith("https://"), "doit commencer par https://")
      .refine(
        (template) => ["{z}", "{x}", "{y}"].every((placeholder) => template.includes(placeholder)),
        "doit contenir {z}, {x} et {y}",
      ),
    MAIN_APP_MAP_TILE_ATTRIBUTION: z.string().min(1),
    // Les fournisseurs (dont OpenStreetMap) exigent un User-Agent qui identifie l'application.
    MAIN_APP_MAP_TILE_USER_AGENT: z.string().min(1),
    MAIN_APP_MAP_TILE_MAX_ZOOM: positiveIntegerFromText.max(22).default(19),
    MAIN_APP_MAP_TILE_CACHE_ENTRIES: positiveIntegerFromText.max(100_000).default(2000),
  }),
  messaging: z.object({
    MAIN_APP_UPLOADS_DIRECTORY: z.string().min(1).default("/data/uploads"),
    MAIN_APP_UPLOAD_MAX_BYTES: positiveIntegerFromText.max(50 * 1024 * 1024).default(10 * 1024 * 1024),
  }),
  calls: z.object({
    // Origine publique exacte de l'app (schéma + hôte + port) : seule origine
    // autorisée à ouvrir le WebSocket de signalisation.
    MAIN_APP_PUBLIC_ORIGIN: z
      .string()
      .refine((origin) => URL.canParse(origin) && new URL(origin).origin === origin, "doit être une origine seule, ex. https://app.exemple.fr"),
    // Serveurs STUN/TURN au format RTCIceServer, en JSON. Par défaut : un STUN public, pas de TURN.
    MAIN_APP_ICE_SERVERS: z
      .string()
      .transform((json, context) => {
        try {
          return iceServersSchema.parse(JSON.parse(json));
        } catch {
          context.addIssue({ code: "custom", message: "doit être un tableau JSON de serveurs ICE valide" });
          return z.NEVER;
        }
      })
      .default(DEFAULT_ICE_SERVERS),
  }),
  jobs: z.object({}),
};

const loadedConfigurationByFeature = new Map();

/**
 * Configuration du conteneur `featureName` (auth, map, messaging, calls, jobs),
 * lue une seule fois. Lève une erreur listant TOUTES les variables en défaut.
 */
export function loadConfiguration(featureName) {
  if (loadedConfigurationByFeature.has(featureName)) {
    return loadedConfigurationByFeature.get(featureName);
  }
  const featureSchema = featureConfigurationSchemas[featureName];
  if (!featureSchema) {
    throw new Error(`Fonctionnalité inconnue pour la configuration : ${featureName}`);
  }

  // docker compose transmet une variable absente de .env comme chaîne vide
  // (`${VAR:-}`) : elle compte comme absente, pour que sa valeur par défaut s'applique.
  const definedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([, environmentValue]) => environmentValue !== ""),
  );
  const parsedEnvironment = sharedConfigurationSchema.extend(featureSchema.shape).safeParse(definedEnvironment);
  if (!parsedEnvironment.success) {
    // Noms des variables seulement : jamais leur valeur, qui peut être un secret.
    const problems = parsedEnvironment.error.issues.map((issue) => `${issue.path.join(".")} : ${issue.message}`);
    throw new Error(`Configuration invalide (${featureName}) :\n- ${problems.join("\n- ")}`);
  }

  const environment = parsedEnvironment.data;
  // Un cookie non Secure circule en clair sur HTTP : toléré seulement hors production.
  if (environment.MAIN_APP_ENVIRONMENT === "production" && !environment.MAIN_APP_COOKIE_SECURE) {
    throw new Error("Configuration invalide : MAIN_APP_COOKIE_SECURE=false est interdit en production.");
  }

  const configuration = Object.freeze({ featureName, ...environment });
  loadedConfigurationByFeature.set(featureName, configuration);
  return configuration;
}

/** Pour les tests : relire l'environnement après l'avoir modifié. */
export function forgetLoadedConfiguration() {
  loadedConfigurationByFeature.clear();
}
