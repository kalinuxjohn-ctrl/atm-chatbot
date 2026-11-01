/**
 * Crée le PREMIER administrateur (ou un autre), en saisie interactive.
 *
 *   docker compose -f docker-compose.yml -f docker-compose.main-app.yml \
 *     exec main-app-auth node src/jobs/createAdmin.js
 *
 * Aucun mot de passe par défaut n'existe dans le code : il est tapé ici,
 * masqué à l'écran, et seul son empreinte argon2id est enregistrée.
 */

import readline from "node:readline";

import { loadConfiguration } from "../core/config.js";
import { closeDatabasePool, initializeDatabasePool } from "../core/database.js";
import { newPasswordSchema, usernameSchema } from "../schemas/auth/authSchemas.js";
import { createAccount } from "../services/auth/accountAdministrationService.js";

function askQuestion(questionText, { hideAnswer = false } = {}) {
  return new Promise((resolve) => {
    const lineReader = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hideAnswer) {
      // Remplace chaque caractère tapé par rien : le mot de passe n'apparaît pas à l'écran.
      lineReader._writeToOutput = (text) => {
        if (text.includes(questionText)) {
          process.stdout.write(text);
        }
      };
    }
    lineReader.question(questionText, (answer) => {
      lineReader.close();
      if (hideAnswer) {
        process.stdout.write("\n");
      }
      resolve(answer);
    });
  });
}

async function askUntilValid(questionText, schema, options) {
  for (;;) {
    const parsedAnswer = schema.safeParse(await askQuestion(questionText, options));
    if (parsedAnswer.success) {
      return parsedAnswer.data;
    }
    process.stdout.write(`  ${parsedAnswer.error.issues[0].message}\n`);
  }
}

async function createAdministratorInteractively() {
  if (!process.stdin.isTTY) {
    throw new Error("Saisie interactive requise : lancer avec `docker compose exec` (terminal attaché).");
  }
  initializeDatabasePool(loadConfiguration("jobs"));

  const username = await askUntilValid("Nom d'utilisateur de l'administrateur : ", usernameSchema);
  const fullNameAnswer = (await askQuestion("Nom complet (vide = nom d'utilisateur) : ")).trim();
  const password = await askUntilValid("Mot de passe (10 à 128 caractères) : ", newPasswordSchema, { hideAnswer: true });
  const confirmation = await askQuestion("Confirmer le mot de passe : ", { hideAnswer: true });
  if (confirmation !== password) {
    throw new Error("Les deux mots de passe sont différents. Rien n'a été créé.");
  }

  const technicianId = await createAccount({
    username,
    password,
    role: "admin",
    fullName: fullNameAnswer.slice(0, 200) || username,
  });
  process.stdout.write(`Administrateur « ${username} » créé (technician_id ${technicianId}).\n`);
}

createAdministratorInteractively()
  .catch((error) => {
    process.stderr.write(`Échec : ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);
