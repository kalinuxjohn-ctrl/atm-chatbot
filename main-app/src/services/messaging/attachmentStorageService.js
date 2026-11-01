/**
 * Fichiers des pièces jointes sur le volume main-app-uploads.
 *
 * - Nom de fichier RÉGÉNÉRÉ (UUID aléatoire, sans extension) : le nom envoyé
 *   par l'utilisateur n'est jamais utilisé, donc aucun « ../ » ni
 *   « image.php » possible.
 * - Dossier hors des fichiers statiques : un fichier n'est lisible que par la
 *   route authentifiée qui vérifie la participation à la conversation.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const STORAGE_FILE_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Chemin d'un fichier stocké ; refuse tout nom qui ne serait pas un UUID (défense en profondeur). */
export function resolveStoredFilePath(uploadsDirectory, storageFileName) {
  if (!STORAGE_FILE_NAME_PATTERN.test(storageFileName)) {
    throw new Error("Nom de fichier stocké invalide.");
  }
  return path.join(uploadsDirectory, storageFileName);
}

export async function writeAttachmentFile(uploadsDirectory, fileBytes) {
  const storageFileName = randomUUID();
  // wx : échoue plutôt que d'écraser un fichier existant ; 600 : lisible par ce seul utilisateur.
  await fs.writeFile(resolveStoredFilePath(uploadsDirectory, storageFileName), fileBytes, { flag: "wx", mode: 0o600 });
  return storageFileName;
}

export async function deleteAttachmentFile(uploadsDirectory, storageFileName) {
  await fs.rm(resolveStoredFilePath(uploadsDirectory, storageFileName), { force: true });
}

/** Fichiers du dossier plus anciens que `minimumAgeMilliseconds` (job de nettoyage). */
export async function listStoredFilesOlderThan(uploadsDirectory, minimumAgeMilliseconds) {
  const directoryEntries = await fs.readdir(uploadsDirectory, { withFileTypes: true });
  const oldFileNames = [];
  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isFile() || !STORAGE_FILE_NAME_PATTERN.test(directoryEntry.name)) {
      continue;
    }
    const { mtimeMs } = await fs.stat(path.join(uploadsDirectory, directoryEntry.name));
    if (Date.now() - mtimeMs > minimumAgeMilliseconds) {
      oldFileNames.push(directoryEntry.name);
    }
  }
  return oldFileNames;
}
