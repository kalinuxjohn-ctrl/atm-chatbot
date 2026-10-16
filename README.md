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
3. Un seul appel au LLM (`message_understanding_service`) reçoit toute la
   conversation (au plus `CHAT_HISTORY_MAX_MESSAGES` anciens messages), le type
   d'appareil et le détail des résultats de la dernière recherche, relus en
   base. Avec Claude, la consigne système et les anciens messages sont mis en
   cache (1 h) : d'un message à l'autre, ils sont relus à ~10 % du prix ; seul
   le dernier message (contexte du tour + message du technicien) est payé plein
   tarif. La trace `[LLM] Utilisation du cache Claude` donne les jetons lus en cache. Il renvoie une intention, des
   références textuelles et, hors diagnostic, sa réponse. Si sa sortie est
   invalide, une erreur explicite est remontée (HTTP 503), sans deviner.
4. Selon l'intention :
   - conversation (tout ce qui n'est pas une nouvelle panne : « détaille le
     cas 2 », suivi, question générale…) : la réponse du LLM est renvoyée telle
     quelle, sans second appel ni recherche vectorielle. Le résultat dont il
     parle (`result_position`) est vérifié puis retenu comme `selected_result` ;
   - diagnostic : résolution SQL des références, embedding du texte reformulé,
     recherche vectorielle filtrée par type d'appareil et seuil de pertinence,
     préparation des cas réels, puis synthèse LLM. Le prompt demande au LLM
     de vérifier leur pertinence technique, d'écarter les cas sans lien établi
     et de signaler si aucun ne convient. Les pistes indirectes doivent expliquer
     leurs limites. Les suggestions générales sont introduites brièvement par
     « En complément, voici mes conseils de chatbot », sans inventer de faits
     historiques ni de fiabilité. Ces consignes sont communes à Gemini et Claude.
     Ce contrôle porte sur la réponse :
     les candidats mémorisés dans le contexte restent inchangés.
5. Sans cas réel, le diagnostic tente les statistiques agrégées. Sans résultat,
   le LLM est appelé pour proposer des vérifications explicitement identifiées
   comme des conseils du chatbot après une phrase signalant l'absence de résultat,
   sans avertissement répétitif. Une panne
   fournisseur continue de remonter en erreur, sans réponse de secours.
6. L'orchestrateur sauvegarde la réponse et le contexte, valide la transaction,
   puis la route retourne `{conversation_id, reply}`.

Les références modèle/code d'erreur sont mémorisées, mais ne filtrent pas
encore la recherche vectorielle : seul le type d'appareil est utilisé.
Une panne de pgvector est remontée sans calcul Python de secours. La recherche autonome
`GET /api/error_code/search` utilise SQL ILIKE, sans embedding ni LLM.

Les menus de suggestions du Copilote répondent aussi sans IA, avec des réponses enregistrées en base (migration 0011) :

| Route | Rôle |
| --- | --- |
| `GET /api/usual_problem?device_type=gab` | pannes fréquentes de l'équipement (table `usual_problem`) |
| `GET /api/usual_problem/{id}/solution` | réponse enregistrée d'une panne fréquente |
| `GET /api/error_code?device_type=gab` | codes d'erreur ayant une réponse enregistrée (`error_code.device_type` et `error_code.reply`) |
| `GET /api/error_code/{id}/solution` | réponse enregistrée d'un code d'erreur |

Les administrateurs les gèrent dans `admin.html` (rubriques « Codes d'erreur » et « Pannes fréquentes »), via des routes protégées par `ADMIN_API_KEY` (en-tête `X-Admin-Key`) :
`GET`/`POST /api/admin/error_code`, `PUT`/`DELETE /api/admin/error_code/{id}`, et de même pour `/api/admin/usual_problem`. Un code cité par une proposition de solution ne peut pas être supprimé (409) : vider sa réponse le retire du Copilote.

## Erreurs des ressources externes

- Claude/Gemini : erreur réseau, délai dépassé, quota, authentification ou
  réponse inexploitable -> `LLMUnavailableError`, puis HTTP 503. Aucun
  changement de fournisseur ni texte de secours, même pour la synthèse des cas.
- Voyage : les erreurs et les embeddings invalides (dimension, valeurs,
  nombre ou indices incorrects) deviennent `EmbeddingUnavailableError`, puis
  HTTP 503. Aucun vecteur artificiel ; les textes vides sont refusés en 422.
  Les nouvelles tentatives bornées sur 429/5xx rappellent la même API :
  ce ne sont pas des replis vers un autre fournisseur.
- PostgreSQL/pgvector : échec explicite en HTTP 503, sans recherche alternative.
  Les savepoints préservent la transaction appelante lors d'une erreur vectorielle.
- Statistiques recalculées après une écriture déjà validée : un échec renvoie
  HTTP 409 en précisant que la donnée est enregistrée et ne doit pas être
  soumise une seconde fois. Aucun succès silencieux.

Les journaux indiquent la cause technique des erreurs d'IA ; les réponses
HTTP restent neutres et n'exposent ni clés, ni prompts, ni données SQL.
Une recherche réussie sans résultat reste un cas métier normal, pas une panne.
Le seed n'a aucun mode dégradé : si Voyage échoue, il s'arrête en erreur.

## Tests ciblés

`python -B -m unittest discover -s tests -p test_tracing.py -v`

`python -B -m unittest discover -s tests -p test_text_validation_service.py -v`

`python -B -m unittest discover -s tests -p test_llm_providers.py -v`

`python -B -m unittest discover -s tests -p test_external_services.py -v`

`node --experimental-default-type=module --test tests/test_external_services_frontend.mjs`

`python -B -m unittest discover -s tests -p test_solution_proposal_service.py -v`

Les opérations métier sont simulées, sans appel au LLM ni requête réelle.
L'import du backend nécessite néanmoins une configuration valide et un
pilote de base de données disponible. Pour une vérification isolée, lancer
depuis un répertoire sans `.env`, avec la racine du projet dans `PYTHONPATH`
et `DATABASE_URL=sqlite:///:memory:` ; aucun schéma SQLite n'est créé.

## Propositions de solution

Quand une réponse du chat contient des solutions, `POST /api/chat` renvoie
`solution_proposal_available: true` et le Copilote affiche « Aucune de ces
solutions ne fonctionne », puis « Proposer une solution ».

1. `GET /api/chat/conversations/{id}/solution-proposal-context?technician_id=`
   relit le problème actif dans `conversation_context` (dernière recherche,
   résultat sélectionné sinon le premier) et le renvoie pour affichage.
   409 si aucun problème n'est identifié, 403 si la conversation appartient
   à un autre technicien.
2. `POST /api/chat/conversations/{id}/solution-proposals` ne reçoit que
   l'action, le résultat et `outcome_status`. Le backend relit le contexte,
   crée une ligne `solution_proposal` (statut `pending`, migration 0009) avec
   un `conversation_context_snapshot`, et ajoute la confirmation à l'historique.
3. Page `admin.html`, routes `/api/admin/solution-proposals` protégées par
   `ADMIN_API_KEY` (en-tête `X-Admin-Key`) : approuver ou rejeter. Une
   approbation ajoute l'action au catalogue `action`, ou réutilise une action
   équivalente (distance <= `ACTION_CATALOG_MATCH_MAX_DISTANCE`, 0.15).
   L'approbation rattache aussi la solution au problème : une ligne
   `intervention_action` est ajoutée à l'intervention de référence, avec
   `targets_symptom_id` = le symptôme du problème (déjà vectorisé, aucun
   embedding recalculé) et `source_proposal_id` (migration 0010), puis les
   statistiques sont recalculées. Le chat la présente à part : « Solution
   ajoutée ensuite, proposée par … et validée par un administrateur ».
   Une décision est définitive ; un rejet exige un commentaire.

Le « cas de référence » (intervention, symptôme, composant) est le cas passé
auquel la recherche a rattaché le problème : la conversation n'est pas encore
liée à une intervention en cours, donc `device_id` reste vide.

## Ajout d'intervention

Pour ajouter à l'historique un problème que le Copilote ne connaît pas, avec
tout ce que le technicien a fait. Rien n'est visible dans la recherche avant
la validation d'un administrateur.

1. `POST /api/intervention_add` : le technicien envoie l'appareil
   (`device_id` ou `device_serial_number`), `final_outcome_status`, les
   `symptoms`, les `actions` dans l'ordre (`targets_symptom_number` = n° du
   symptôme visé, 1 = le premier) et, s'il l'a trouvée, la cause (`diagnosis`).
   Une ligne `intervention_add` est créée (statut `pending`, migration 0012).
   Règles vérifiées (sinon 422) : une intervention `resolved` a une action
   `is_confirmed_solution`, qui a `outcome_status = resolved`, et inversement.
   `GET /api/intervention_add?technician_id=` liste ses demandes.
2. Routes `/api/admin/intervention_add` (clé `X-Admin-Key`) :
   - `GET /{id}` : contenu actuel et envoi d'origine (`submitted_content`, jamais modifié) ;
   - `GET /{id}/preview` : **ce que l'approbation écrira, table par table**
     (`intervention`, `intervention_symptom`, `intervention_action`,
     `diagnosis`, nouvelles entrées des catalogues `symptom` et `action`).
     Pour chaque symptôme et chaque action, `catalog_link` dit d'où vient le
     rattachement au catalogue : `chosen_by_admin`, `matched_existing`
     (distance ≤ `SYMPTOM_CATALOG_MATCH_MAX_DISTANCE` ou
     `ACTION_CATALOG_MATCH_MAX_DISTANCE`) ou `new_catalog_entry` ;
   - `PUT /{id}` : corriger le contenu ou imposer `catalog_symptom_id`,
     `catalog_action_id`, `catalog_text`, `root_cause_component_id` ;
   - `POST /{id}/approve` : écrit tout en une transaction (embeddings calculés
     avant : si Voyage ne répond pas, rien n'est écrit), puis recalcule les
     statistiques. L'aperçu et l'approbation utilisent le même code.
   - `POST /{id}/reject` : commentaire obligatoire, rien n'est écrit.

Les écritures directes `POST /interventions` et `POST /interventions/{id}/actions`
sont désormais réservées à l'administrateur (`X-Admin-Key`).

Le Copilote expose le formulaire technicien depuis le menu gauche et sous les
réponses sans cas pertinent. `POST /api/chat` renvoie
`intervention_add_available` et `intervention_add_problem` pour cette offre :
nouvelle recherche vide, ou déclaration d'absence de résultat selon les formules
imposées au LLM (y compris lorsqu'il écarte les candidats). Dans ce dernier cas,
une reformulation libre de cette déclaration par le modèle ne déclenche pas
l'offre ; le bouton du menu reste toujours accessible. Une réponse de suivi ou
un message rejeté par la validation locale ne déclenche pas de nouvelle offre.
La migration `db/migrations/0012_intervention_add.sql` doit être appliquée aux
bases existantes avant l'envoi d'une proposition.

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