# ATM Maintenance Chatbot — Fichier de compréhension du projet

Ce document sert à faire comprendre le projet à une IA qui n'a jamais vu le
code, pour qu'elle puisse reprendre le travail directement.

---

## 1. Objectif

Un chatbot d'aide au diagnostic pour les techniciens qui interviennent sur
des distributeurs automatiques de billets (ATM). Aujourd'hui, quand un
technicien intervient, il note ses observations sur papier ou dans un
outil qui n'exploite jamais l'historique des interventions passées.

Le but : que chaque intervention (symptômes observés, actions tentées,
résultat de chaque action) soit enregistrée dans une base structurée, pour
qu'ensuite, face à un nouveau problème, le technicien décrive ce qu'il voit
et le système retrouve automatiquement des interventions passées
similaires (recherche sémantique), puis un LLM résume ces cas réels en
langage naturel ("sur une machine similaire, ceci a été tenté puis cela a
résolu le problème"). Le système ne doit JAMAIS inventer une solution : il
ne fait que retrouver et reformuler des cas réels déjà enregistrés.

## 2. Architecture choisie

- **Backend** : Python + FastAPI.
- **Base de données** : PostgreSQL, avec l'extension **pgvector** pour la
  recherche sémantique plus tard — pas de base vectorielle séparée, tout
  reste dans la même base relationnelle transactionnelle.
- **Contrainte forte : rester 100% gratuit / auto-hébergé.** Pas de clé API
  payante nulle part :
  - LLM : **Ollama en local** (ex: modèle `qwen:8b`) à la place de l'API
    Claude/Anthropic initialement envisagée.
  - Embeddings (vecteurs) : un moteur auto-hébergé (pas encore choisi
    précisément — Voyage AI a été écarté pour la même raison de coût).
- **Déploiement** : Docker Compose avec 3 services :
  - `db` : Postgres + pgvector (image `pgvector/pgvector:pg16`)
  - `init-db` : conteneur qui s'exécute une fois, applique les migrations
    SQL dans l'ordre puis lance le script de seed, et s'arrête
  - `web` : l'API FastAPI elle-même (port 8000)
- **Principe de conception central** : séparer le **catalogue normalisé**
  (vocabulaire contrôlé et réutilisable : `symptom`, `action`) de
  **l'enregistrement brut** (`raw_text` — ce que le technicien a écrit
  exactement, pour telle intervention précise). Les deux se rejoignent via
  des tables de jonction (`intervention_symptom`, `intervention_action`).
  C'est sur `raw_text` que portera la recherche sémantique plus tard, pas
  sur le texte normalisé.

## 3. Rôle des répertoires

- **`db/migrations/`** — scripts SQL numérotés (`0001` à `0004`), un par
  étape du schéma, appliqués dans l'ordre par `init-db`. Table par table :
  qui/quoi/quand (0001), catalogue + jonctions (0002), pgvector (0003 —
  pas encore appliquée dans `docker-compose.yml`), stats dérivées (0004 —
  idem, pas encore appliquée).
- **`db/seed/`** — script d'insertion de données de démonstration (le cas
  Alan/Bob du design doc d'origine).
- **`app/core/`** — tout ce qui est transverse à toute l'application :
  configuration (variables d'environnement) et connexion à la base.
- **`app/models/`** — la représentation SQLAlchemy des tables : une classe
  Python = une table SQL. Ce sont des objets qui parlent à la BASE.
- **`app/schemas/`** — les contrats de données Pydantic pour l'API : ce
  qu'un client HTTP envoie et reçoit. Volontairement séparés des modèles
  (une table peut avoir des colonnes qu'on ne veut jamais exposer côté
  API, ou l'inverse).
- **`app/services/`** — toute la logique métier (créer une intervention,
  chercher des cas similaires, appeler le LLM...), indépendante de FastAPI
  — testable sans lancer un serveur web.
- **`app/api/routes/`** — les endpoints FastAPI eux-mêmes : ils reçoivent
  la requête HTTP, appellent un service, renvoient la réponse. Pas de
  logique métier ici, seulement du câblage HTTP.
- **`app/jobs/`** — tâches exécutées périodiquement, en dehors du cycle
  requête/réponse HTTP (ex: recalcul nocturne de statistiques).
- **`tests/`** — tests automatisés.

### Fichiers qui portent le même nom de base dans plusieurs répertoires

Ce n'est pas une redondance, chaque couche a un rôle différent pour le
même concept métier :

- `models/intervention.py` (table SQL) / `schemas/intervention_schema.py`
  (contrat API) / `services/intervention_service.py` (logique métier) :
  trois couches pour le même concept "intervention".
- `api/routes/chat.py` + `schemas/chat_schema.py` : l'endpoint de
  conversation avec le chatbot (le technicien décrit son problème, reçoit
  une réponse) — **existe dans l'arborescence mais son contenu n'a pas
  encore été vérifié dans cette conversation.**
- `services/embeddings_service.py`, `services/retrieval_service.py`,
  `services/llm_service.py` : la chaîne de traitement IA prévue à terme —
  vectoriser le texte du technicien, chercher les cas similaires, puis
  résumer via le LLM. **Existent dans l'arborescence mais contenu non
  vérifié ici — probablement des squelettes correspondant à
  l'architecture proposée au début du projet, pas forcément implémentés.**
- `services/stats_service.py` (la logique de calcul) vs
  `jobs/recompute_stats.py` (ce qui déclenche ce calcul périodiquement) :
  même séparation logique métier / déclencheur que pour `main.py` vs
  les routes.

**⚠️ Point à vérifier avant de s'appuyer dessus** : ces fichiers (`chat.py`,
`chat_schema.py`, `embeddings_service.py`, `llm_service.py`,
`retrieval_service.py`, `stats_service.py`, `recompute_stats.py`,
`tests/test_embeddings.py`, `tests/test_retrieval.py`) n'ont pas été créés
dans cette conversation — ouvrez-les d'abord pour voir s'ils sont vides,
des squelettes commentés, ou déjà codés, avant de continuer dessus.

**⚠️ Autre point** : deux fichiers d'environnement semblent coexister,
`env.example` et `env .example` (avec un espace, probablement un doublon
accidentel) — à nettoyer.

## 4. Ce qui a déjà été fait (vérifié fonctionnel)

- Les 4 migrations SQL (`0001` : technician/manufacturer/atm_model/atm/
  intervention ; `0002` : component/symptom/action + jonctions +
  diagnosis ; `0003` : colonne `embedding` + index pgvector, écrite mais
  **pas encore appliquée** dans `docker-compose.yml` ; `0004` : table de
  stats dérivée, écrite mais **pas encore appliquée** non plus).
- Le script de seed (cas Alan : résolu par réinitialisation du lecteur de
  carte ; cas Bob : mêmes symptômes partiels, résolu différemment par
  remplacement d'un capteur).
- Les modèles SQLAlchemy pour `technician`, `atm` (+ manufacturer/model/
  version), `catalog` (component/symptom/action/stats), `intervention` (+
  intervention_symptom/intervention_action/diagnosis). **La colonne
  `embedding` est volontairement absente du modèle `InterventionSymptom`
  actuellement, car la migration 0003 n'est pas encore appliquée** — les
  deux doivent avancer ensemble.
- Le schéma Pydantic, le service et la route pour `intervention` :
  `POST /interventions` (créer) et `GET /interventions/{id}` (lire) — les
  deux endpoints fonctionnent, testés avec `curl` contre les données
  seedées.
- La config (`app/core/config.py`) adaptée pour Ollama (champ
  `ollama_base_url`, pas de clé Anthropic ni Voyage AI requise).
- Le `docker-compose.yml` (3 services) corrigé et fonctionnel.

### Bugs rencontrés et corrigés en cours de route (utile pour ne pas les reproduire)

1. `DATABASE_URL` doit être `postgresql+psycopg2://...` (pas juste
   `postgresql://...`) pour que SQLAlchemy 2.x utilise `psycopg2-binary`
   plutôt que `psycopg` (v3, non installé).
2. Le script de seed appelle `psycopg2.connect()` **directement** (pas via
   SQLAlchemy) : il faut retirer le `+psycopg2` de l'URL avant de le lui
   passer, sinon DSN invalide.
3. `main.py` doit **explicitement importer `app.models`** (le package
   entier, pas juste `app.models.intervention`) pour que toutes les
   classes ORM (`Atm`, `Technician`, etc.) soient enregistrées avant que
   SQLAlchemy essaie de résoudre les `relationship("NomDeClasse", ...)`
   passées en chaîne de caractères — sinon erreur
   `InvalidRequestError: ... failed to locate a name`.
4. Un fichier modifié localement doit rester en encodage **UTF-8** —
   un enregistrement dans un autre encodage corrompt les accents (deviennent
   des `?`) sans empêcher le code de tourner, donc ce n'est pas toujours
   visible immédiatement.

## 5. Plan proposé pour la suite

Dans l'ordre logique (chaque étape s'appuie sur la précédente) :

1. **Enregistrer les actions/résultats** (`intervention_action`) — même
   principe que les symptômes, complète la boucle d'enregistrement d'une
   intervention (symptômes observés → actions tentées → résultat).
2. **Normalisation** : rattacher le `raw_text` saisi par le technicien à
   une entrée du catalogue (`symptom_id` / `action_id`), manuellement pour
   commencer.
3. **Choisir le moteur de vecteurs local** (ex: `sentence-transformers`
   auto-hébergé) et appliquer la migration `0003_pgvector.sql` dans
   `docker-compose.yml` (+ ajouter la colonne `embedding` au modèle
   `InterventionSymptom` en même temps).
4. **Recherche sémantique** (`retrieval_service.py`) : étant donné un
   nouveau texte de symptôme, retrouver les interventions passées les plus
   proches.
5. **Résumé via Ollama** (`llm_service.py`) : présenter les cas retrouvés
   en langage naturel, sans jamais inventer d'information hors de ce qui a
   été retrouvé.
6. **Job de recalcul des statistiques** (`stats_service.py` +
   `recompute_stats.py`) : appliquer la migration `0004` et calculer
   périodiquement le taux de succès de chaque paire (symptôme, action).
7. *(Optionnel, plus tard)* Rendre les 4 migrations idempotentes
   (`IF NOT EXISTS` partout, y compris les `CREATE TYPE`), pour que
   relancer `init-db` sans repartir d'une base vide ne produise plus
   d'erreurs bruyantes dans les logs.
