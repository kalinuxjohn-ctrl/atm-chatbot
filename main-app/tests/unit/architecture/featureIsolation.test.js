/**
 * Règle d'architecture : une fonctionnalité n'importe jamais le code d'une
 * autre. Chaque fichier de src/{routes,controllers,services,models,schemas}/<feature>/
 * ne peut importer que : core/, middlewares/, sa propre fonctionnalité, et
 * des paquets npm. Les points d'entrée (entrypoints/) ne sont importés par personne.
 *
 * Le test lit les `import ... from "..."` de chaque fichier et résout leur
 * chemin : il échoue en citant le fichier et l'import fautifs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src");
const FEATURE_NAMES = ["auth", "map", "messaging", "calls"];
const FEATURE_LAYERS = ["routes", "controllers", "services", "models", "schemas"];
const IMPORT_SPECIFIER_PATTERN = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function listJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listJavaScriptFiles(entryPath) : entry.name.endsWith(".js") ? [entryPath] : [];
  });
}

/** La fonctionnalité d'un fichier de src/, ou null pour core/, middlewares/, jobs/, entrypoints/. */
function findFeatureOfSourceFile(absoluteFilePath) {
  const [layer, featureName] = path.relative(sourceDirectory, absoluteFilePath).split(path.sep);
  return FEATURE_LAYERS.includes(layer) && FEATURE_NAMES.includes(featureName) ? featureName : null;
}

function findForbiddenImports(absoluteFilePath, fileText = fs.readFileSync(absoluteFilePath, "utf8")) {
  const importingFeature = findFeatureOfSourceFile(absoluteFilePath);
  const forbiddenImports = [];
  for (const match of fileText.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const importSpecifier = match[1] ?? match[2];
    if (!importSpecifier.startsWith(".")) {
      continue; // paquet npm ou module node: : autorisé
    }
    const importedFilePath = path.resolve(path.dirname(absoluteFilePath), importSpecifier);
    const importedRelativePath = path.relative(sourceDirectory, importedFilePath);
    const importedFeature = findFeatureOfSourceFile(importedFilePath);
    const importsAnEntrypoint = importedRelativePath.split(path.sep)[0] === "entrypoints";
    if (importsAnEntrypoint || (importedFeature !== null && importedFeature !== importingFeature)) {
      forbiddenImports.push(`${path.relative(sourceDirectory, absoluteFilePath)} importe ${importSpecifier}`);
    }
  }
  return forbiddenImports;
}

describe("isolation des fonctionnalités", () => {
  test("aucune fonctionnalité n'importe le code d'une autre fonctionnalité", () => {
    const featureFiles = FEATURE_LAYERS.flatMap((layer) => listJavaScriptFiles(path.join(sourceDirectory, layer)));
    expect(featureFiles.length).toBeGreaterThan(0);
    expect(featureFiles.flatMap((filePath) => findForbiddenImports(filePath))).toEqual([]);
  });

  test("core/ et middlewares/ (partagés) n'importent aucune fonctionnalité", () => {
    const sharedFiles = ["core", "middlewares"].flatMap((folder) => listJavaScriptFiles(path.join(sourceDirectory, folder)));
    expect(sharedFiles.flatMap((filePath) => findForbiddenImports(filePath))).toEqual([]);
  });

  test("le contrôle détecte bien un import interdit (fichier fictif, rien n'est écrit sur le disque)", () => {
    const fictitiousMapServicePath = path.join(sourceDirectory, "services", "map", "fictitiousService.js");
    const forbiddenImportText = 'import { sendMessage } from "../messaging/messageService.js";\n';
    const allowedImportText = 'import { trace } from "../../core/tracing.js";\nimport { z } from "zod";\n';
    expect(findForbiddenImports(fictitiousMapServicePath, forbiddenImportText)).toHaveLength(1);
    expect(findForbiddenImports(fictitiousMapServicePath, allowedImportText)).toEqual([]);
  });
});
