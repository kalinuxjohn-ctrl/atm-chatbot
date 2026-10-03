# ATM Maintenance Chatbot — Comprendre le backend en 10 minutes

Ce document explique **uniquement le backend** (FastAPI + PostgreSQL).
Le dossier `frontend/` n'est pas décrit ici.

---

## 1. Le projet en une phrase

Un technicien décrit une panne de **GAB** (distributeur de billets) ou de
**TPE** (terminal de paiement). Le backend retrouve dans la base des
**interventions passées similaires** (recherche sémantique), puis un **LLM
local** les reformule en français.

> **Règle d'or : le système n'invente jamais de solution.** Il retrouve des
> cas réels et le LLM ne fait que les reformuler. Chaque prompt le lui
> interdit explicitement.

---

## 2. Les briques techniques

| Brique | Choix | Où |
| --- | --- | --- |
| API | Python + FastAPI | `app/main.py` |
| Base de données | PostgreSQL 16 + extension **pgvector** | `docker-compose.yml` (service `db`) |
| Embeddings (texte → vecteur) | `OrdalieTech/Solon-embeddings-large-0.1` via `sentence-transformers`, **1024 dimensions**, en local (GPU si dispo) | `app/services/embeddings_service.py` |
| LLM | **Ollama en local** (modèle par défaut `llama3.1`) | `app/services/llm_service.py` |
| Déploiement | Docker Compose : `db` → `init-db` → `web` | `docker-compose.yml` |

Tout est **gratuit et auto-hébergé** : aucune clé d'API payante.

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
├── migrations/        0001 → 0007, SQL appliqué une seule fois par init-db
└── seed/              données de démo (Alan, Bob, codes d'erreur)
tests/                 test_embeddings, test_retrieval, test_error_code_search
```

Règle : **route → service → base**. Une route ne contient jamais de logique.

---

## 4. Le flux principal : du message à la réponse (`POST /chat`)

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

Dans `chat_orchestrator_service.py`, **dans cet ordre** :

1. **Le message cite une position ET une recherche existe déjà** dans le
   contexte (« donne-moi plus d'aide sur le **deuxième** ») →
   `_handle_result_detail_request` : on recharge ce cas précis depuis la base
   et le LLM répond **uniquement** à partir de ce cas.
2. **Le message ressemble à un symptôme** (`_looks_like_symptom_description`) :
   au moins 15 caractères et pas de mot de relance (« pourquoi », « quelle
   action », « plus de détail »…) → `_handle_symptom_search` : recherche
   sémantique, puis résumé LLM.
3. **Sinon** → réponse courte du LLM, sans données techniques.

---

## 6. La recherche sémantique, étape par étape

### 6.1 Embedding de la question

`embeddings_service.generate_embedding(texte, is_query=True)` :
- nettoie le texte (espaces multiples, bords) ;
- ajoute le préfixe `"query : "` (attendu par Solon pour une **question**) ;
- encode avec `normalize_embeddings=True` → vecteur de 1024 nombres ;
- vérifie la dimension (erreur claire si le modèle ne correspond pas à la config).

Le modèle est chargé **une seule fois** puis gardé en mémoire (`lru_cache`).

> Les textes **stockés** sont encodés avec `is_query=False` (sans préfixe) :
> Solon distingue « question » et « document ».

### 6.2 Recherche des symptômes proches

`retrieval_service.fetch_similar_symptoms(db, texte, device_type)` :
- requête pgvector sur `intervention_symptom.embedding` avec l'opérateur
  `<=>` (distance cosinus), convertie en `similarity = 1 - distance` ;
- **filtre par `device_type`** (jointure `intervention` → `device`) : un
  symptôme de TPE ne sort jamais pour un GAB ;
- **seuil de pertinence** `SYMPTOM_SIMILARITY_THRESHOLD` (0.5 par défaut) :
  ce qui est en dessous est éliminé ;
- **repli automatique** : si pgvector échoue, `rollback` puis calcul du
  cosinus en Python, avec le même format de sortie.

### 6.3 Regroupement en cas réels

`case_retrieval_service.find_similar_cases()` :
- cherche 8 symptômes, puis **regroupe par intervention** (une intervention
  peut matcher via plusieurs symptômes, on garde sa meilleure note) ;
- garde les **3 meilleures interventions** ;
- `build_case()` assemble pour chacune : technicien, machine, symptôme
  trouvé, actions dans l'ordre, diagnostic, résultat final et **fiabilité**
  (lue dans `symptom_action_outcome_stats` pour l'action qui a résolu le cas).

### 6.4 Restitution par le LLM

`_summarize_cases()` met chaque cas sur une ligne (`_format_case`), construit
un prompt « résume ces cas, garde l'ordre Cas 1 / Cas 2…, **n'invente rien** »
et appelle `llm_service.generate_reply()`.

`llm_service` passe par une interface `LLMProvider` (aujourd'hui
`OllamaProvider`) : changer de LLM = ajouter une classe. **Il ne lève jamais
d'erreur vers l'API** : si Ollama est injoignable, le texte de l'erreur
(« Impossible de joindre Ollama… ») devient la réponse.

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
    "query": "la carte reste bloquée",
    "results": [
      {"position": 1, "kind": "case", "intervention_id": 3001},
      {"position": 2, "kind": "case", "intervention_id": 3045}
    ]
  },
  "selected_result": {"position": 2, "kind": "case", "intervention_id": 3045}
}
```

Comment ça marche :
- après chaque recherche, `record_last_search()` mémorise **les cas affichés
  avec leur numéro** (et efface l'ancienne sélection) ;
- quand le technicien écrit « le **deuxième** », `resolve_position_reference()`
  trouve **2** grâce à une simple table d'ordinaux (premier/1er … quatrième/4ème),
  **sans LLM** : c'est 100 % prévisible ;
- `select_result_by_position()` retrouve l'`intervention_id` correspondant ;
  le cas est **relu en base** (`build_case`) puis envoyé au LLM avec la question ;
- `device_type` est mémorisé une fois et réutilisé aux tours suivants.

**Limites actuelles, à connaître :**
- une relance **sans ordinal** (« pourquoi ? », « plus de détail ») n'est pas
  reliée au cas précédent : elle part dans la réponse LLM générique ;
- l'historique brut des messages est stocké mais **pas renvoyé au LLM**
  (`conversation_service.get_recent_messages()` existe mais n'est pas utilisée) ;
- si aucun `device_type` n'a été donné, la recherche filtre sur `NULL` et ne
  trouve rien : le front doit l'envoyer au moins au premier message ;
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
| Codes d'erreur | `fault`, `error_code` | référentiel indépendant (recherche SQL classique) |

**Migrations** (`db/migrations/`, appliquées dans l'ordre, une seule fois,
suivies dans `schema_migrations`) :
`0001` parc + interventions · `0002` catalogue + jonctions + diagnostic ·
`0003` pgvector + index HNSW · `0004` stats · `0005` action liée à un symptôme
précis · `0006` conversations + contexte · `0007` codes d'erreur.

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
| `POST /chat` | conversation complète (flux du §4) | `chat_orchestrator_service` |
| `POST /chat/search-symptom` | recherche « statistique » sans conversation : symptômes proches → actions classées par fiabilité + résumé LLM | `retrieval_service.find_ranked_solutions` + `llm_service.summarize_solutions` |
| `POST /interventions` | créer une intervention + symptômes (embeddings + rattachement catalogue) | `intervention_service` |
| `GET /interventions/{id}` | lire une intervention | `intervention_service` |
| `POST /interventions/{id}/actions` | ajouter une action tentée | `intervention_service` |
| `GET /catalog/actions/similar` | actions du catalogue proches d'un texte (avant d'en créer une) | `catalog_service` |
| `POST /catalog/actions/resolve` | créer une action au catalogue ou fusionner (`new` / `merge`) + recalcul des stats | `catalog_service` |
| `GET /api/error_code/search` | recherche de code d'erreur (SQL `ILIKE`, sans IA) | `error_code_service` |
| `GET /health` | l'API répond-elle ? | `main.py` |

Documentation interactive : <http://localhost:8000/docs>.

**Deux recherches complémentaires, à ne pas confondre :**
- `find_similar_cases` (dans `/chat`) répond à la question « **montre-moi des cas réels** », chacun raconté ;
- `find_ranked_solutions` (dans `/chat/search-symptom`) répond à « **qu'est-ce qui marche le mieux statistiquement** ».

---

## 11. Configuration (`app/core/config.py`, lue depuis `.env`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg2://…/atm_chatbot` | connexion BDD |
| `EMBEDDING_MODEL_NAME` / `EMBEDDING_DIMENSIONS` | Solon / 1024 | modèle d'embedding |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://localhost:11434` / `llama3.1` | LLM |
| `SYMPTOM_SIMILARITY_THRESHOLD` | 0.5 | seuil de pertinence de la recherche |
| `SYMPTOM_CATALOG_MATCH_MAX_DISTANCE` | 0.15 | seuil de rattachement automatique au catalogue |

⚠️ `Settings` refuse les variables inconnues : `OLLAMA_HOST`, `OLLAMA_PORT`
et `HF_HOME` présentes dans `.env` font échouer le démarrage hors Docker. Il
faut soit les retirer de `.env`, soit les déclarer dans `Settings`.

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

Ollama doit tourner **sur l'hôte**, accessible depuis le conteneur via
`host.docker.internal`.

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
