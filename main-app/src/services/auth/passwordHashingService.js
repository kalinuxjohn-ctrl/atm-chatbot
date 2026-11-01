/**
 * Hachage des mots de passe avec argon2id (recommandation OWASP).
 *
 * Paramètres : 19 Mio de mémoire, 2 passes, 1 fil (minimum OWASP). Ils sont
 * enregistrés dans l'empreinte elle-même : les relever plus tard n'invalide
 * pas les anciens mots de passe.
 */

import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plainPassword) {
  return argon2.hash(plainPassword, ARGON2_OPTIONS);
}

export async function passwordMatchesHash(plainPassword, passwordHash) {
  try {
    return await argon2.verify(passwordHash, plainPassword);
  } catch {
    // Empreinte illisible (corrompue) : refus, sans faire planter la connexion.
    return false;
  }
}

/**
 * Empreinte d'un mot de passe aléatoire, calculée une fois au démarrage.
 * Quand le nom d'utilisateur n'existe pas, on vérifie QUAND MÊME un mot de
 * passe contre elle : la réponse prend le même temps qu'avec un vrai compte,
 * et le temps de réponse ne révèle pas quels noms existent.
 */
let decoyPasswordHashPromise = null;
export function getDecoyPasswordHash() {
  decoyPasswordHashPromise ??= hashPassword(crypto.randomUUID());
  return decoyPasswordHashPromise;
}
