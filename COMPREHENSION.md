# ATM Maintenance Chatbot — Comprendre le backend en 10 minutes

Ce document explique **uniquement le backend** (FastAPI + PostgreSQL).
Le dossier `frontend/` n'est pas décrit ici.

---

## 1. Le projet en une phrase

Un technicien décrit une panne de **GAB** (distributeur de billets) ou de
**TPE** (terminal de paiement). Le backend retrouve dans la base des
**interventions passées similaires** (recherche sémantique), puis un **LLM**
(Claude ou Gemini) les reformule en français.

> **Règle d'or : le système n'invente jamais de solution.** Il retrouve des
> cas réels et le LLM ne fait que les reformuler. Chaque prompt le lui
> interdit explicitement.

---

## 2. Les briques techniques

| Brique | Choix | Où |
| --- | --- | --- |
| API | Python + FastAPI | `app/main.py` |
| Base de données | PostgreSQL 16 + extension **pgvector** | `docker-compose.yml` (service `db`) |
| Embeddings (texte → vecteur) | **Voyage AI** (`voyage-3-large`, API), **1024 dimensions** | `app/services/embeddings_service.py` |
| LLM | **Claude par défaut**, Gemini disponible | `app/services/llm_service.py` |
| Déploiement | Docker Compose : `db` → `init-db` → `web` (+ `frontend/docker-compose.yml`) | `docker-compose.yml` |

Le backend et la base sont auto-hébergés ; le LLM (Claude ou Gemini) et les
embeddings (Voyage AI) sont des **API externes avec clé** (fichier `.env`).

---

## 3. Organisation du code

```text
app/
├── main.py            crée l'app FastAPI, branche les routes, /health
├── core/              config (.env), connexion BDD, traces [TRACE]
├── models/            tables SQL en classes SQLAlchemy (1 classe = 1 table)
├── schemas/           contrats JSON de l'API (Pydantic)
├── api/routes/        endpoints HTTP — aucun métier, ils appellent un service
├── services/          TOUTE la logique métier
└── jobs/              tâches hors requête HTTP (recalcul des stats)
db/
├── migrations/        0001 → 0012, SQL appliqué une seule fois par init-db
└── seed/              données de démo (Alan, Bob, codes d'erreur)
tests/                 tests unitaires (unittest), sans réseau ni base réelle
```

Règle : **route → service → base**. Une route ne contient jamais de logique.

---

## 4. Le flux principal : du message à la réponse (`POST /api/chat`)

C'est le cœur du projet. Le chef d'orchestre est
`app/services/chat_orchestrator_service.py` → `handle_chat_message()`.

```text
Technicien
   │  { conversation_id?, technician_id, message, device_type? (gab|tpe) }
   ▼
1. routes/chat.py            reçoit et valide (schemas/conversation_schema.py)
   ▼
2. conversation_service      récupère la conversation, ou en crée une
   ▼
3. context_service           charge le contexte JSON de la conversation
   │                         (+ mémorise device_type s'il est fourni)
   ▼
4. conversation_service      enregistre le message "user"
   ▼
5. _route_message()          décide QUOI faire du message (voir §5)
   │   ├─ demande de détail ("le deuxième")  → détail d'un cas déjà trouvé
   │   ├─ description de symptôme             → recherche sémantique + résumé LLM
   │   └─ autre (salut, question courte)      → réponse LLM simple
   ▼
6. conversation_service      enregistre la réponse "assistant"
   ▼
7. context_service           sauvegarde le contexte mis à jour
   ▼
8. db.commit()  →  { conversation_id, reply }
```

Le front renvoie ensuite le `conversation_id` reçu à chaque message suivant :
c'est ce qui relie les messages entre eux.

---

## 5. Comment le message est aiguillé (`_route_message`)

Le message validé part en **un seul appel LLM** (`message_understanding_service`)
avec toute la conversation (mise en cache chez Claude) et le détail des résultats de
la dernière recherche relus en base (`_describe_last_search`). Le LLM renvoie
une intention, et sa réponse si ce n'est pas un diagnostic. Puis, dans
`chat_orchestrator_service.py` :

1. **`diagnostic`** (nouvelle panne) → `_handle_symptom_search` : recherche
   sémantique **par symptôme** (le LLM liste et numérote chaque symptôme du
   message dans `symptoms`), puis résumé LLM.
2. **`conversation`** (tout le reste : « détaille le cas 2 », « ça n'a pas
   marché », l'heure…) → la réponse du LLM est renvoyée telle quelle. Si le LLM
   indique un résultat (`result_position`), le backend vérifie qu'il existe
   dans la dernière recherche et le retient comme `selected_result`.

---

## 6. La recherche sémantique, étape par étape

### 6.0 Un symptôme = une recherche

Le LLM renvoie, en plus de la reformulation globale, la liste numérotée des
symptômes du message (`UnderstoodMessage.symptoms`) :

```json
"symptoms": [
  {"number": 1, "text": "L'écran du GAB reste noir"},
  {"number": 2, "text": "La carte reste bloquée dans le lecteur"}
]
```

Le schéma nettoie la liste (doublons, vides) et renumérote 1, 2, 3 ;
l'orchestrateur en garde au plus `MAX_SYMPTOMS_PER_MESSAGE` (5). **Chaque
symptôme a son propre embedding et sa propre recherche** : un message à
plusieurs symptômes ne donne plus un vecteur « moyen », loin de chacun d'eux.
Liste vide : la reformulation sert de symptôme unique (comportement d'avant).

### 6.1 Embedding des symptômes

`embeddings_service.generate_embedding(texte, is_query=True)` (un symptôme) ou
`generate_embeddings_batch(textes, is_query=True)` (plusieurs symptômes, **un
seul appel** à Voyage) :
- nettoie le texte (espaces multiples, bords) ;
- appelle Voyage AI avec `input_type = "query"` → vecteur de 1024 nombres ;
- vérifie la dimension (erreur claire si le modèle ne correspond pas à la config).

Les vecteurs de recherche unitaires sont gardés en cache (`lru_cache`).

> Les textes **stockés** sont encodés avec `is_query=False`
> (`input_type = "document"`) : Voyage distingue « question » et « document ».

### 6.2 Recherche des symptômes proches

`retrieval_service.fetch_similar_symptoms_per_symptom(db, textes, device_type)`
lance, pour chaque symptôme, `fetch_similar_symptoms(db, texte, device_type)` :
- requête pgvector sur `intervention_symptom.embedding` avec l'opérateur
  `<=>` (distance cosinus), convertie en `similarity = 1 - distance` ;
- **filtre par `device_type`** (jointure `intervention` → `device`) : un
  symptôme de TPE ne sort jamais pour un GAB ;
- **filtre par modèle** si le message en cite un (`model_name_text`) ;
- **seuil de pertinence** `SYMPTOM_SIMILARITY_THRESHOLD` (0.5 par défaut) :
  ce qui est en dessous est éliminé ;
- **erreur explicite** : si pgvector échoue, annulation du savepoint puis
  erreur HTTP 503, sans calcul Python de secours.

### 6.3 Regroupement en cas réels

`case_retrieval_service.find_similar_cases(..., symptoms=...)` :
- cherche 8 symptômes enregistrés **par symptôme du technicien**, puis
  **regroupe par intervention** (`_group_matches_by_intervention`) : pour
  chaque intervention, la meilleure correspondance de **chaque** symptôme du
  technicien. Une intervention peut donc recouper plusieurs symptômes ;
- classe (`_case_rank_key`) d'abord par **nombre de symptômes recoupés**,
  puis par **similarité moyenne**, et garde les **3 meilleures** ;
- `build_case()` assemble pour chacune : technicien, machine, symptômes
  recoupés (`matched_symptoms`), actions dans l'ordre, diagnostic, résultat
  final et **fiabilité** (lue dans `symptom_action_outcome_stats` pour l'action
  qui a résolu le cas). La correspondance la plus proche reste la référence
  unique du cas (`matched_symptom_text`, `matched_intervention_symptom_id`),
  utilisée par les propositions de solution.

### 6.4 Restitution par le LLM

`_summarize_cases()` met chaque cas sur une ligne (`_format_case`, qui liste
les symptômes recoupés et le numéro du symptôme du technicien correspondant),
construit un prompt « résume ces cas, garde l'ordre Cas 1 / Cas 2…, **n'invente
rien** » et appelle `llm_service.generate_reply()`. Avec plusieurs symptômes, le
prompt les liste numérotés et demande d'indiquer, pour chaque cas, ceux qu'il
recoupe, et de signaler un symptôme recoupé par aucun cas.

`llm_service` passe par une interface `LLMProvider` (`ClaudeProvider` ou
`GeminiProvider`), choisie avec `LLM_PROVIDER`. Une indisponibilité remonte
à l'API (503 neutre), sauf si l'appelant fournit un texte de secours :
celui-ci est alors renvoyé et la cause est journalisée.

---

## 7. La gestion du contexte (pour demander plus d'aide)

Fichier : `app/services/context_service.py`. Table : `conversation_context`
(**une ligne JSON par conversation**).

Contenu typique du contexte :

```json
{
  "device_type": "gab",
  "intent": "diagnostic",
  "last_search": {
    "query": "la carte reste bloquée et l'écran est noir",
    "symptoms": [
      {"number": 1, "text": "La carte reste bloquée"},
      {"number": 2, "text": "L'écran est noir"}
    ],
    "results": [
      {"position": 1, "kind": "case", "intervention_id": 3001,
       "matched_intervention_symptom_id": 9001,
       "matched_symptoms": [{"query_symptom_number": 1, "intervention_symptom_id": 9001, "...": "..."}]},
      {"position": 2, "kind": "case", "intervention_id": 3045}
    ]
  },
  "selected_result": {"position": 2, "kind": "case", "intervention_id": 3045}
}
```

Comment ça marche :
- après chaque recherche, `record_last_search()` mémorise **les cas affichés
  avec leur numéro** (et efface l'ancienne sélection) ;
- à chaque message, les résultats mémorisés sont **relus en base**
  (`build_case`) et envoyés au LLM avec toute la conversation : c'est lui qui
  comprend « le **cas 2** », « le deuxième » ou « celui d'Alan » ;
- le LLM renvoie le numéro du résultat visé ; `select_result_by_position()`
  vérifie qu'il existe et le retient (référence d'une proposition de solution) ;
- `device_type` est mémorisé une fois et réutilisé aux tours suivants.

**Limites actuelles, à connaître :**
- les échanges des menus de suggestions (pannes fréquentes, codes d'erreur)
  ne sont pas enregistrés côté backend : le LLM ne les voit pas ;
- l'historique envoyé est limité aux `CHAT_HISTORY_MAX_MESSAGES` (100) derniers messages ;
- si aucun `device_type` n'a été donné (ni dans l'interface, ni dans le
  message), aucune recherche n'est lancée : le Copilote demande GAB ou TPE ;
- un `technician_id` inexistant provoque une erreur de clé étrangère (500).

---

## 8. Le stockage : comment une intervention entre dans la base

`POST /interventions` → `intervention_service.create_intervention_with_symptoms()` :

1. pour chaque symptôme saisi, calcul de l'**embedding "document"**
   (`is_query=False`) ;
2. **rattachement automatique au catalogue** : `find_best_catalog_match()`
   cherche le symptôme catalogué le plus proche (même `device_type`) ; si
   la distance ≤ `symptom_catalog_match_max_distance` (0.15, soit environ 85 %
   de similarité), on reprend son `symptom_id`, sinon il reste `NULL` ;
3. insertion de l'intervention + symptômes, puis écriture des vecteurs en SQL
   direct (`store_symptom_embedding`), car la colonne `embedding` n'est pas
   mappée dans l'ORM.

`POST /interventions/{id}/actions` ajoute une action tentée (ordre
automatique, résultat, `is_confirmed_solution`) et **recalcule les stats** si
l'action est cataloguée.

**Principe clé** : on sépare
- le **brut** (`raw_text`), c'est-à-dire ce que le technicien a écrit, qui sert à la recherche sémantique ;
- le **catalogue** (`symptom`, `action`), c'est-à-dire un vocabulaire contrôlé qui sert aux statistiques.

---

## 9. Les données de la base

| Groupe | Tables | Rôle |
| --- | --- | --- |
| Parc | `manufacturer`, `device_model`, `device_model_version`, `device` | les machines ; `device.device_type` = **`gab` ou `tpe` uniquement** (ENUM SQL) |
| Personnes | `technician` | qui intervient |
| Interventions | `intervention`, `intervention_symptom` (+ `embedding vector(1024)`), `intervention_action`, `diagnosis` | l'historique réel |
| Catalogue | `component`, `symptom`, `action` | vocabulaire normalisé |
| Statistiques | `symptom_action_outcome_stats` | fiabilité de chaque paire (symptôme, action) **par type d'appareil** |
| Conversation | `conversation`, `conversation_message`, `conversation_context` | fil de chat + mémoire JSON |
| Codes d'erreur | `fault`, `error_code` | référentiel indépendant (recherche SQL classique) ; `device_type` + `reply` = réponse enregistrée du menu de suggestions |
| Pannes fréquentes | `usual_problem` | menu de suggestions du Copilote, réponse enregistrée par les admins (sans IA) |

**Migrations** (`db/migrations/`, appliquées dans l'ordre, une seule fois,
suivies dans `schema_migrations`) :
`0001` parc + interventions · `0002` catalogue + jonctions + diagnostic ·
`0003` pgvector + index HNSW · `0004` stats · `0005` action liée à un symptôme
précis · `0006` conversations + contexte · `0007` codes d'erreur · `0008`
embeddings Voyage (1024) · `0009` propositions de solution · `0010` action
issue d'une proposition · `0011` menus de suggestions · `0012` ajouts
d'intervention.

**`device_type`** : contrôlé en base (ENUM) et dans l'API par
`app/schemas/device_type.py`. `" GAB "` et `"Tpe"` sont normalisés en
`gab`/`tpe` ; toute autre valeur est rejetée (422).

### Les statistiques

`stats_service.recompute_stats()` vide puis recalcule
`symptom_action_outcome_stats` : pour chaque (symptôme catalogué, action
cataloguée, `device_type`), on compte les tentatives (`attempts`), les succès
(`successes`) et on calcule `accuracy_score = successes / attempts`.
Il est lancé par `init-db`, après l'ajout d'une action cataloguée, et par
`python -m app.jobs.recompute_stats` (prévu pour un CRON).

### Les données de démo (`db/seed/seed_demo_data.py`)

- 2 GAB (501, 502), 2 techniciens (**7 Alan**, **8 Bob**) ;
- **Intervention 3001 (Alan)** : carte retenue + transaction bloquée + pas
  d'espèces → 3 actions, seule la **réinitialisation du lecteur** résout ;
- **Intervention 3045 (Bob)** : symptômes en partie communs → résolue par le
  **remplacement du capteur** : même panne, autre solution, rien n'est fusionné ;
- codes d'erreur E42, E43, E67 ;
- calcul des embeddings des 6 symptômes (`EMBEDDING_BACKFILL`, dont le texte
  doit être **identique mot pour mot** à celui des `INSERT`) ;
- idempotent (`ON CONFLICT DO NOTHING`), mais **ne met pas à jour** une ligne
  déjà présente.

---

## 10. Toutes les routes

| Méthode et route | Rôle | Service |
| --- | --- | --- |
| `POST /api/chat` | conversation complète (flux du §4) | `chat_orchestrator_service` |
| `GET /api/chat/conversations/{id}/solution-proposal-context`, `POST /api/chat/conversations/{id}/solution-proposals` | proposer une solution (voir README) | `solution_proposal_service` |
| `POST`/`GET /api/intervention_add` | proposer une nouvelle intervention (validée par un admin) | `intervention_add_service` |
| `/api/admin/solution-proposals`, `/api/admin/intervention_add` | validation admin (clé `X-Admin-Key`) | `solution_proposal_service`, `intervention_add_service` |
| `POST /api/chat/search-symptom` | recherche « statistique » sans conversation : symptômes proches → actions classées par fiabilité + résumé LLM | `retrieval_service.find_ranked_solutions` + `llm_service.summarize_solutions` |
| `POST /interventions` | créer une intervention + symptômes (embeddings + rattachement catalogue), admin | `intervention_service` |
| `GET /interventions/{id}` | lire une intervention | `intervention_service` |
| `POST /interventions/{id}/actions` | ajouter une action tentée | `intervention_service` |
| `GET /catalog/actions/similar` | actions du catalogue proches d'un texte (avant d'en créer une) | `catalog_service` |
| `POST /catalog/actions/resolve` | créer une action au catalogue ou fusionner (`new` / `merge`) + recalcul des stats | `catalog_service` |
| `GET /api/error_code/search` | recherche de code d'erreur (SQL `ILIKE`, sans IA) | `error_code_service` |
| `GET /api/error_code?device_type=…`, `GET /api/error_code/{id}/solution` | menu « Codes d'erreur connus » : liste et réponse enregistrée (sans IA) | `error_code_service` |
| `GET /api/usual_problem?device_type=…`, `GET /api/usual_problem/{id}/solution` | menu « Pannes fréquentes » : liste et réponse enregistrée (sans IA) | `usual_problem_service` |
| `GET`/`POST /api/admin/error_code`, `PUT`/`DELETE /api/admin/error_code/{id}` | administration des codes d'erreur (clé `X-Admin-Key`) | `error_code_service` |
| `GET`/`POST /api/admin/usual_problem`, `PUT`/`DELETE /api/admin/usual_problem/{id}` | administration des pannes fréquentes (clé `X-Admin-Key`) | `usual_problem_service` |
| `GET /health` | l'API répond-elle ? | `main.py` |

Documentation interactive : <http://localhost:8000/docs>.

**Deux recherches complémentaires, à ne pas confondre :**
- `find_similar_cases` (dans `/chat`) répond à la question « **montre-moi des cas réels** », chacun raconté ;
- `find_ranked_solutions` (dans `/api/chat/search-symptom`, et en repli dans `/api/chat`) répond à « **qu'est-ce qui marche le mieux statistiquement** ».

---

## 11. Configuration (`app/core/config.py`, lue depuis `.env`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg2://…/atm_chatbot` | connexion BDD |
| `EMBEDDING_PROVIDER` / `VOYAGE_API_KEY` / `VOYAGE_MODEL` / `EMBEDDING_DIMENSIONS` | `voyage` / clé vide / `voyage-3-large` / 1024 | embeddings |
| `LLM_PROVIDER` | `claude` | fournisseur LLM (`claude` ou `gemini`) |
| `CLAUDE_API_KEY` / `CLAUDE_MODEL` | clé vide / `claude-sonnet-5-5` | API Claude |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | clé vide / `gemini-3.5-flash-lite` | API Gemini |
| `SYMPTOM_SIMILARITY_THRESHOLD` | 0.5 | seuil de pertinence de la recherche |
| `SYMPTOM_CATALOG_MATCH_MAX_DISTANCE` | 0.15 | seuil de rattachement automatique au catalogue |
| `ACTION_CATALOG_MATCH_MAX_DISTANCE` | 0.15 | réutilisation d'une action du catalogue à l'approbation |
| `MAX_SYMPTOMS_PER_MESSAGE` | 5 | symptômes d'un message cherchés séparément |
| `CHAT_HISTORY_MAX_MESSAGES` | 100 | anciens messages envoyés au LLM |
| `ADMIN_API_KEY` | vide (admin désactivé) | clé des routes `/api/admin` |

`Settings` ignore les variables inconnues (`extra="ignore"`) : le fichier
`.env` peut être partagé avec Docker Compose.

---

## 12. Lancer et observer

```powershell
docker compose up -d        # db → init-db (migrations + seed + stats) → web:8000
docker compose logs -f web  # suivre les traces
```

Chaque étape importante écrit une ligne `[TRACE][CATÉGORIE]` (`app/core/tracing.py`).
Les catégories utilisées sont REQUEST, CONTEXT, PROCESSING, SEARCH, EMBEDDING,
LLM, RESPONSE et ERROR. Suivre ces lignes permet de voir tout le trajet d'un
message, de la requête à la réponse.

Le backend doit accéder à l'API du fournisseur choisi et recevoir sa clé
via `.env` (`CLAUDE_API_KEY` ou `GEMINI_API_KEY`).

---

## 13. Pièges déjà rencontrés (ne pas les reproduire)

1. `DATABASE_URL` doit commencer par `postgresql+psycopg2://` (SQLAlchemy 2.x).
2. Le seed utilise `psycopg2` directement : il retire `+psycopg2` de l'URL.
3. `main.py` doit importer `app.models` (le package entier), sinon les
   `relationship("…")` ne trouvent pas leurs classes.
4. Après un échec pgvector, il faut faire un **`db.rollback()`**, sinon toute
   requête suivante échoue (`InFailedSqlTransaction`).
5. Garder les fichiers en **UTF-8**, sinon les accents sont corrompus sans
   message d'erreur visible.
6. Un texte du seed modifié dans les `INSERT` doit aussi l'être dans
   `EMBEDDING_BACKFILL`.

---

## 14. Pistes d'amélioration

- Relier les relances sans ordinal (« pourquoi ? ») au dernier cas affiché,
  via `selected_result` ou les derniers messages.
- Renvoyer 404/422 au lieu de 500 pour un `technician_id` inconnu.
- Ajouter une route de lecture de l'historique (`GET /chat/{id}/messages`)
  et une vraie authentification.
- `build_case` lit des champs `device` de façon défensive (`getattr`) : à
  simplifier maintenant que le modèle `Device` est connu.
- Nettoyer les clés `.env` refusées par `Settings`.
