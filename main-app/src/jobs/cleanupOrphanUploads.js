/**
 * Supprime les fichiers du volume main-app-uploads qui n'ont aucune pièce
 * jointe en base (envoi interrompu entre l'écriture du fichier et celle du
 * message). Seuls les fichiers de plus d'une heure sont examinés : un envoi
 * en cours n'est jamais touché.
 *
 * Lancé toutes les 6 heures par le conteneur messaging, ou à la main :
 *   node src/jobs/cleanupOrphanUploads.js
 */

import { pathToFileURL } from "node:url";

import { loadConfiguration } from "../core/config.js";
import { closeDatabasePool, initializeDatabasePool } from "../core/database.js";
import { trace } from "../core/tracing.js";
import { findKnownStorageFileNames } from "../models/messaging/messageModel.js";
import { deleteAttachmentFile, listStoredFilesOlderThan } from "../services/messaging/attachmentStorageService.js";

const MINIMUM_ORPHAN_AGE_MILLISECONDS = 60 * 60 * 1000;

export async function cleanupOrphanUploads(uploadsDirectory) {
  const oldFileNames = await listStoredFilesOlderThan(uploadsDirectory, MINIMUM_ORPHAN_AGE_MILLISECONDS);
  if (oldFileNames.length === 0) {
    return 0;
  }
  const knownFileNames = await findKnownStorageFileNames(oldFileNames);
  const orphanFileNames = oldFileNames.filter((fileName) => !knownFileNames.has(fileName));
  for (const orphanFileName of orphanFileNames) {
    await deleteAttachmentFile(uploadsDirectory, orphanFileName);
  }
  trace("JOB", "Fichiers orphelins supprimés", { deletedFileCount: orphanFileNames.length });
  return orphanFileNames.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configuration = loadConfiguration("messaging");
  initializeDatabasePool(configuration);
  cleanupOrphanUploads(configuration.MAIN_APP_UPLOADS_DIRECTORY)
    .catch((error) => {
      trace("ERROR", "Nettoyage des fichiers orphelins impossible", { errorMessage: error.message });
      process.exitCode = 1;
    })
    .finally(closeDatabasePool);
}
