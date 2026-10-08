# Tracing du backend

Le module `app/core/tracing.py` fournit `trace(category, message, **details)`.
La sortie utilise `logging` et indique la catégorie, le fichier appelant et
le numéro de ligne. Pour désactiver toutes ces traces, mettre
`TRACING_ENABLED = False` dans ce module, puis redémarrer le backend.

Les détails doivent rester des métadonnées : nombres, tailles, durées,
intention validée, identifiant de conversation. Ne pas passer de messages,
prompts, réponses LLM brutes, secrets ou données personnelles à `trace()`.

## Parcours du chat

1. `POST /chat` reçoit et valide le message avec `ChatRequest`.
2. L'orchestrateur charge ou crée la conversation, charge son contexte,
   nettoie et valide le message localement avec `text_validation_service`,
   puis enregistre le texte nettoyé. Un message rejeté reçoit une demande
   de reformulation sans appel LLM, puis passe directement à l'étape 6.
3. Le LLM de compréhension produit une intention et des références textuelles.
   Si sa sortie est invalide, le repli existant traite le message en diagnostic.
4. Selon l'intention :
   - conversation : réponse LLM sans recherche vectorielle ;
   - diagnostic : résolution SQL des références, embedding du texte reformulé,
     recherche vectorielle filtrée par type d'appareil et seuil de pertinence,
     préparation des cas réels, puis synthèse LLM ;
   - détail : résolution d'une position dans la dernière recherche, chargement
     du cas sélectionné et réponse LLM à partir de ce cas.
5. Sans cas réel, le diagnostic tente les statistiques agrégées. Sans résultat,
   une réponse déterministe est retournée sans LLM de synthèse.
6. L'orchestrateur sauvegarde la réponse et le contexte, valide la transaction,
   puis la route retourne `{conversation_id, reply}`.

Les références modèle/code d'erreur sont mémorisées, mais ne filtrent pas
encore la recherche vectorielle : seul le type d'appareil est utilisé.
Le repli pgvector utilise le cosinus Python. La recherche autonome
`GET /api/error_code/search` utilise SQL ILIKE, sans embedding ni LLM.

## Tests ciblés

`python -B -m unittest discover -s tests -p test_tracing.py -v`

`python -B -m unittest discover -s tests -p test_text_validation_service.py -v`

`python -B -m unittest discover -s tests -p test_llm_providers.py -v`

Les opérations métier sont simulées, sans appel au LLM ni requête réelle.
L'import du backend nécessite néanmoins une configuration valide et un
pilote de base de données disponible. Pour une vérification isolée, lancer
depuis un répertoire sans `.env`, avec la racine du projet dans `PYTHONPATH`
et `DATABASE_URL=sqlite:///:memory:` ; aucun schéma SQLite n'est créé.

## Validation locale des messages

`app/services/text_validation_service.py` ne dépend ni de la base ni du LLM,
seulement de la bibliothèque standard. Unicode et espaces sont normalisés,
les accents et identifiants conservés.

Le filtre est volontairement tolérant : il ne rejette que le bruit évident
(message vide, uniquement des symboles, un même motif répété au moins 4 fois
comme `aaaaaa` ou `test test test test`, ou un mot isolé en minuscules avec
5 consonnes d'affilée comme `qsdfghjklm`). Tout le reste passe, y compris les
fautes de frappe, les lignes de log et les phrases incohérentes : le LLM juge.

La route directe `POST /api/chat/search-symptom` applique également ce
contrôle avant recherche et résumé. En cas de rejet, elle renvoie des listes
vides et la demande de reformulation dans `summary`, sans recherche ni LLM.
La trace `VALIDATION` contient le résultat et la raison du rejet, jamais le texte.

La validation reste un module dans le backend existant, sans conteneur
supplémentaire. Les dépendances sont installées dans l'image de base :

```powershell
docker build -f Dockerfile.base -t atm-python-base:latest .
docker compose up -d --build
```

Claude est le fournisseur par défaut ; `LLM_PROVIDER=gemini` reste possible.