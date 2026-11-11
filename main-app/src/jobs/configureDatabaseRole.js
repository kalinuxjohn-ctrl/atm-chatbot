/**
 * Job ponctuel (conteneur main-app-database-setup), lancé avant les
 * conteneurs de la main app : donne au rôle SQL main_app_user son mot de
 * passe et le droit de se connecter.
 *
 * Pourquoi un job : les migrations sont appliquées par le conteneur init-db
 * du chatbot (psql, sans variable d'environnement pour la main app). La
 * migration 0014 crée donc le rôle sans mot de passe (NOLOGIN), et ce job
 * le complète avec MAIN_APP_DATABASE_PASSWORD. Relancé à chaque démarrage,
 * il applique aussi un changement de mot de passe fait dans .env.
 *
 * C'est le SEUL code de la main app qui utilise le compte d'administration
 * de la base (MAIN_APP_DATABASE_ADMIN_URL, repris de DATABASE_URL du chatbot).
 * Il ne crée, ne modifie ni ne supprime aucune table.
 */

import pg from "pg";

import { trace } from "../core/tracing.js";

// Tables attendues apres les migrations 0014 a 0019 : sans elles, les
// conteneurs échoueraient à la première requête. Mieux vaut le dire ici.
const EXPECTED_MAIN_APP_TABLES = [
  "comptes",
  "sessions",
  "blocages_connexion",
  "points_carte",
  "conversations",
  "participants_conversation",
  "messages",
  "pieces_jointes_message",
  "journal_appels",
];

async function configureDatabaseRole() {
  const administrationUrl = process.env.MAIN_APP_DATABASE_ADMIN_URL;
  const mainAppUserPassword = process.env.MAIN_APP_DATABASE_PASSWORD;
  if (!administrationUrl || !mainAppUserPassword) {
    throw new Error("MAIN_APP_DATABASE_ADMIN_URL et MAIN_APP_DATABASE_PASSWORD sont obligatoires.");
  }
  if (mainAppUserPassword.length < 16) {
    throw new Error("MAIN_APP_DATABASE_PASSWORD doit faire au moins 16 caractères.");
  }

  // DATABASE_URL du chatbot est au format SQLAlchemy (postgresql+psycopg2://...) :
  // le pilote Node ne comprend que postgresql://.
  const connectionString = administrationUrl.replace(/^postgres(ql)?\+[a-z0-9_]+:/i, "postgresql:");
  const databaseClient = new pg.Client({ connectionString });
  await databaseClient.connect();
  try {
    const [roleRow] = (await databaseClient.query("SELECT 1 FROM pg_roles WHERE rolname = 'main_app_user'")).rows;
    if (!roleRow) {
      throw new Error("Rôle main_app_user absent : la migration 0014 n'a pas été appliquée (conteneur init-db).");
    }

    const existingTableNames = (
      await databaseClient.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main_app'")
    ).rows.map((tableRow) => tableRow.table_name);
    const missingTableNames = EXPECTED_MAIN_APP_TABLES.filter((tableName) => !existingTableNames.includes(tableName));
    if (missingTableNames.length > 0) {
      throw new Error(`Migrations main_app incomplètes, tables absentes : ${missingTableNames.join(", ")}.`);
    }

    // ALTER ROLE n'accepte pas de paramètre $1 : le mot de passe est échappé
    // par le pilote (escapeLiteral) avant d'être placé dans la requête.
    await databaseClient.query(
      `ALTER ROLE main_app_user WITH LOGIN PASSWORD ${databaseClient.escapeLiteral(mainAppUserPassword)}`,
    );
    trace("DATABASE", "Rôle main_app_user prêt (connexion autorisée)");
  } finally {
    await databaseClient.end();
  }
}

configureDatabaseRole().catch((error) => {
  trace("ERROR", "Préparation du rôle SQL impossible", { errorMessage: error.message });
  process.exit(1);
});
