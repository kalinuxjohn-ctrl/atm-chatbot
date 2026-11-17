/**
 * Règles ESLint de la main app.
 *
 * Deux règles d'architecture et de sécurité, vérifiées à chaque `npm run lint` :
 * 1. Les fonctionnalités (auth, map, messaging, calls) ne s'importent JAMAIS
 *    entre elles : chacune ne dépend que de core/ et middlewares/. Ainsi un
 *    conteneur ne charge que le code de sa fonctionnalité. (Doublé par le test
 *    tests/unit/architecture/featureIsolation.test.js.)
 * 2. Pages web : interdiction de innerHTML / outerHTML / insertAdjacentHTML.
 *    Tout texte saisi par un utilisateur passe par textContent (anti-XSS).
 */

import javascriptRecommended from "@eslint/js";
import globals from "globals";

const FEATURE_NAMES = ["auth", "map", "messaging", "calls"];
const FEATURE_LAYERS = ["routes", "controllers", "services", "models", "schemas"];

function forbidImportsFromOtherFeatures(featureName) {
  const otherFeatureNames = FEATURE_NAMES.filter((otherFeatureName) => otherFeatureName !== featureName);
  return {
    files: FEATURE_LAYERS.map((layer) => `src/${layer}/${featureName}/**/*.js`),
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `/(${FEATURE_LAYERS.join("|")})/(${otherFeatureNames.join("|")})/`,
              message: `La fonctionnalité ${featureName} ne doit importer que core/, middlewares/ et ses propres fichiers.`,
            },
            {
              // Import « voisin » dans la même couche : ../messaging/... depuis services/map/.
              regex: `^\\.\\./(${otherFeatureNames.join("|")})/`,
              message: `La fonctionnalité ${featureName} ne doit importer que core/, middlewares/ et ses propres fichiers.`,
            },
            {
              regex: "/entrypoints/",
              message: "Un point d'entrée n'est jamais importé par une fonctionnalité.",
            },
          ],
        },
      ],
    },
  };
}

export default [
  { ignores: ["node_modules/**", "coverage/**"] },
  javascriptRecommended.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: globals.node },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_|^(request|response|next)$" }] },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ["web/**/*.js", "gateway/html/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      // L et maplibregl : librairies de carte chargées par <script>, servies en local.
      globals: { ...globals.browser, L: "readonly", maplibregl: "readonly" },
    },
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Interdit (XSS) : utiliser textContent ou createElementWithText()." },
        { property: "outerHTML", message: "Interdit (XSS) : construire le DOM avec createElement." },
        { property: "insertAdjacentHTML", message: "Interdit (XSS) : utiliser append() avec des éléments." },
      ],
    },
  },
  ...FEATURE_NAMES.map(forbidImportsFromOtherFeatures),
];
