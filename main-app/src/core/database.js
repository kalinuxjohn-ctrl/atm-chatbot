/**
 * Accès à PostgreSQL : un pool de connexions par conteneur.
 *
 * La base est CELLE DU CHATBOT : la main app y lit et écrit dans le schéma
 * main_app, et n'a qu'un accès restreint à public.technician (SELECT + INSERT,
 * voir db/migrations/0014_main_app_schema.sql). Elle se connecte avec le rôle
 * dédié main_app_user, jamais avec le compte d'administration de la base.
 *
 * Toujours des requêtes paramétrées ($1, $2...) : une valeur saisie par un
 * utilisateur n'est jamais concaténée dans le texte SQL.
 */

import pg from "pg";

import { ExternalServiceUnavailableError } from "./errors.js";
import { trace } from "./tracing.js";

// BIGINT (messages.id) lu comme un nombre JS : sûr tant qu'on reste sous 2^53,
// soit des milliards de messages. Évite de manipuler des chaînes partout.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

let databasePool = null;

export function initializeDatabasePool(configuration) {
  databasePool = new pg.Pool({
    host: configuration.MAIN_APP_DATABASE_HOST,
    port: configuration.MAIN_APP_DATABASE_PORT,
    database: configuration.MAIN_APP_DATABASE_NAME,
    user: configuration.MAIN_APP_DATABASE_USER,
    password: configuration.MAIN_APP_DATABASE_PASSWORD,
    max: 10,
    // Une requête bloquée ne doit pas immobiliser le conteneur indéfiniment.
    statement_timeout: 10_000,
    connectionTimeoutMillis: 5_000,
  });
  // Une connexion inactive qui tombe (base redémarrée) ne doit pas faire planter Node.
  databasePool.on("error", (error) => {
    trace("DATABASE", "Connexion inactive perdue", { errorName: error.name });
  });
  return databasePool;
}

function getDatabasePool() {
  if (!databasePool) {
    throw new Error("Pool de connexions non initialisé : appeler initializeDatabasePool() au démarrage.");
  }
  return databasePool;
}

/** Exécute une requête paramétrée et renvoie ses lignes. */
export async function queryDatabase(sqlText, parameters = [], databaseClient = null) {
  try {
    const result = await (databaseClient ?? getDatabasePool()).query(sqlText, parameters);
    return result.rows;
  } catch (error) {
    throw translateConnectionError(error);
  }
}

/**
 * Exécute `work(databaseClient)` dans une transaction : tout est écrit, ou
 * rien (ex. message + pièce jointe). Le client doit être passé à queryDatabase().
 */
export async function runInTransaction(work) {
  let databaseClient;
  try {
    databaseClient = await getDatabasePool().connect();
  } catch (error) {
    throw translateConnectionError(error);
  }
  try {
    await databaseClient.query("BEGIN");
    const result = await work(databaseClient);
    await databaseClient.query("COMMIT");
    return result;
  } catch (error) {
    await databaseClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    databaseClient.release();
  }
}

/** Vérifie que la base répond (route /health). */
export async function checkDatabaseConnection() {
  await queryDatabase("SELECT 1");
}

export async function closeDatabasePool() {
  if (databasePool) {
    await databasePool.end();
    databasePool = null;
  }
}

/**
 * Base injoignable -> 503 lisible. Les autres erreurs SQL (contrainte violée,
 * bug) restent des erreurs internes : elles signalent un défaut du code.
 */
function translateConnectionError(error) {
  const connectionErrorCodes = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "57P01", "57P03"]);
  if (connectionErrorCodes.has(error.code) || /timeout exceeded when trying to connect/i.test(error.message)) {
    trace("DATABASE", "Base de données injoignable", { errorCode: error.code });
    return new ExternalServiceUnavailableError("Base de données momentanément indisponible.");
  }
  return error;
}
