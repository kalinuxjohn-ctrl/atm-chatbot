# ATM-Chatbot et Espace techniciens

## Commandes Docker directes (WSL)

Avec `.env` déjà configuré, depuis la racine du dépôt :

```bash
docker compose up
```

Pour reconstruire après une modification : `docker compose up --build`.
Pour lancer en arrière-plan : `docker compose up -d` (ou `up -d --build`).
Pour voir les services et les ports : `docker compose ps`.
Les contrôles automatiques `/health` réussis ne sont pas affichés dans les logs
du frontend, de l'API et du gateway. Les erreurs et les autres requêtes restent visibles.
[`compose.yaml`](compose.yaml), chargé automatiquement par Docker, regroupe les
trois configurations existantes avec le même projet et les mêmes volumes.
Le fichier du backend s'appelle `compose.backend.yaml` pour éviter l'avertissement
de plusieurs fichiers de configuration par défaut.

Le nom public est defini par `APP_NAME=atm-chatbot` dans `.env`. Il est applique
au build aux titres, textes, logos SVG et a la navigation de toutes les pages
(connexion, carte, messagerie, appels, administration et chatbot).
Apres un changement de nom, relancer `docker compose up -d --build`.
Utiliser 1 a 80 caracteres : lettres ASCII, chiffres, espaces, points, tirets
ou underscores. Les routes, cles de stockage du navigateur et volumes restent
inchanges pour conserver les sessions et les donnees.

Les tables sont renommées automatiquement par la migration 0019 au démarrage,
sans supprimer les données. Voir les [noms français et le retour arrière](docs/tables-en-francais.md).
Le bouton œil sur la page de connexion affiche ou masque le mot de passe
uniquement dans le navigateur ; il est masqué à nouveau lors de l'envoi.
Les comptes existants restent inchangés. L'application utilise par défaut 8080,
l'API 8000 et PostgreSQL 5433 ; `ps` affiche les ports réellement publiés.
`DB_PORT` permet de changer le port PostgreSQL publié sans modifier son port interne.
L'image Python de base est construite automatiquement avant `chatbot-backend` et `init-db`,
meme sur une nouvelle installation Docker. Le service auxiliaire `python-base`
termine immediatement avec le code 0 ; il n'ouvre aucun port.
Les embeddings sont calculés par l'API Voyage, et Claude/Gemini sont appelés
par HTTP : aucune dépendance PyTorch, CUDA, sentence-transformers ni modèle
Hugging Face local n'est installée. Les reconstructions ne téléchargent plus
ces bibliothèques. Les anciens caches locaux ne sont plus montés ni utilisés ;
ils ne sont pas supprimés automatiquement.
Les lanceurs ci-dessous sont facultatifs, pas nécessaires à ces commandes.

### Rôle de chaque conteneur

| Service Compose | Rôle | Port local par défaut |
|---|---|---|
| `main-app-gateway` | Entrée de l'application : sert les pages, vérifie les sessions et relaie les requêtes vers chaque module. | 8080 |
| `chatbot-frontend` | Interface du chat ; relaie ses appels API en conservant l'identité vérifiée par le gateway. | Aucun (5173 interne) |
| `chatbot-backend` | API FastAPI : conversations et historique, compréhension Claude/Gemini, codes d'erreur en DB, recherche via Voyage et administration du chatbot. | 8000 |
| `main-app-auth` | Connexion, sessions, mots de passe hachés, comptes et rôles. | Aucun (3000 interne) |
| `main-app-map` | Points de la carte, tuiles et calcul d'itinéraires via OpenRouteService. | Aucun (3000 interne) |
| `main-app-messaging` | Messagerie entre techniciens et pièces jointes persistées dans le volume d'uploads. | Aucun (3000 interne) |
| `main-app-calls` | Signalisation WebSocket des appels WebRTC ; l'audio ne passe pas par ce service. | Aucun (3000 interne) |
| `db` | PostgreSQL avec pgvector : comptes, conversations, interventions, codes et vecteurs. Données conservées dans `pgdata`. | 5433 (5432 interne) |
| `init-db` | Job ponctuel : migrations manquantes et import des JSON de codes. Le lancement local désactive les données de démonstration. | Aucun |
| `main-app-database-setup` | Job ponctuel : configure l'accès SQL du rôle dédié `main_app_user`. Ne crée pas les comptes utilisateurs. | Aucun |
| `python-base` | Construit l'image Python commune ; le conteneur auxiliaire termine normalement avec le code 0. | Aucun |

Claude, Gemini, Voyage et OpenRouteService sont des API externes, pas des conteneurs locaux.
Les jobs ponctuels peuvent apparaître `Exited (0)` : ce n'est pas une panne.
`docker compose up` ne crée pas le premier administrateur ; utiliser le lanceur
ou la commande de création interactive ci-dessous sur une installation neuve.

L'ancien service `web` s'appelle désormais `chatbot-backend`. Son alias réseau
`chatbot-api` est conservé pour les relais du frontend et du gateway.
Après une mise à jour de `CLAUDE_API_KEY` dans `.env` :

```bash
docker compose up -d --no-deps --force-recreate chatbot-backend
docker compose logs -f chatbot-backend
```

Pour redemarrer sans changement des images, `docker compose up -d` suffit :
`--build` n'est utile qu'apres une modification. Le contexte du build Python
est limite a `app`, `db` et aux dependances par `.dockerignore`, sans les caches
Python ni les fichiers locaux. Sous WSL, un depot dans `/mnt/f` reste sur le
disque Windows ; pour de meilleures performances de lecture, preferer un
depot dans le systeme de fichiers Linux (par exemple `~/projets/atm-chatbot`).

### Réponses instantanées aux messages simples

Le service [`greeting_service.py`](app/services/greeting_service.py) répond
localement aux messages entiers suivants, sans appel Claude/Gemini, sans
préparation ou résumé de l'historique et sans recherche :

| Type | Messages |
|---|---|
| Salutation | `bonjour`, `salut`, `bonsoir`, `hello`, `coucou`, `slt` |
| Présentation | `qui es-tu`, `qui es tu`, `qui est tu` |
| Services | `quels sont tes services`, `que peux-tu faire`, `que peux tu faire` |

Les questions de présentation et de services acceptent aussi une variante
avec `?`, avec ou sans espace avant. Seuls le nettoyage habituel du texte
(espaces, caractères invisibles) et la casse sont normalisés : aucun mot
supplémentaire ni ponctuation non listée n'est supprimé. Ainsi, `BONJOUR`
répond localement, mais `bonjour le GAB est en panne` et `bonjour!` suivent
le traitement LLM habituel. Une photo acceptée passe toujours par ce traitement.
Les messages locaux sont enregistrés dans la conversation comme les autres,
sans effacer le contexte du diagnostic précédent.

La trace `Réponse locale, sans appel LLM ni recherche` confirme ce chemin.
Le temps total dépend encore des accès à la base et du réseau local.
Pour les autres messages, `Appel Claude terminé | elapsed_ms=...` mesure
l'appel HTTP complet (réseau et traitement fournisseur), pas uniquement
la génération. Un `cache_read_tokens=0` avec `cache_write_tokens>0` indique
la création du cache, pas une réutilisation ; ces traces ne permettent pas
de distinguer le temps réseau, l'attente fournisseur et la génération.

### Latence de Claude Sonnet 5.5

Sonnet 5.5 active par défaut la réflexion adaptative à effort élevé, même
sans champ `thinking`. La compréhension d'un message peut ne pas réfléchir,
alors que la synthèse des cas déclenche une réflexion plus longue. Le budget
de sortie est partagé entre réflexion et réponse.

Par défaut, `CLAUDE_FAST_CHAT=true` fixe `output_config.effort=low` et
`thinking.type=between_tools` pour les synthèses textuelles Sonnet 5.5 uniquement.
La compréhension en JSON contraint garde les réglages d'origine : la
combinaison du mode rapide et du schéma a provoqué des attentes sans réponse
HTTP pendant les essais, contrairement à chacun de ces usages séparés.
Le chatbot n'envoie
pas d'outils à Claude : ce mode supprime donc la réflexion préalable. Le JSON
contraint, le cache, les règles de pertinence et de provenance restent en place.
Ce réglage privilégie la latence, avec un compromis possible sur la qualité
du raisonnement ; `CLAUDE_FAST_CHAT=false` rétablit le mode adaptatif.
Les autres modèles et Gemini ne sont pas modifiés.
Voir les [recommandations Anthropic pour le chat](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5).

Sonnet 5.5 utilise aussi le streaming SSE **entre le backend et Claude** :
les événements maintiennent la connexion active et le backend reconstitue
la réponse complète. Le chat écrit utilise `POST /api/chat/stream` :
les morceaux de rédaction finale sont relayés immédiatement au navigateur
et affichés progressivement, sans animation artificielle après génération.
Le JSON interne de compréhension n'est jamais affiché. Les réponses locales,
du catalogue ou déjà rédigées dans ce JSON arrivent en un seul morceau.
Le mode vocal et l'ancienne route `POST /api/chat` restent inchangés.

Le flux NDJSON contient `delta` (texte provisoire), `ping`, puis `done`
(réponse canonique après enregistrement) ou `error` (statut et message sûr).
Les boutons d'écoute et de contribution n'apparaissent qu'après réussite.
Une coupure conserve le texte visible avec la mention « texte incomplet »
et propose un nouvel essai ; aucune réponse partielle n'est sauvegardée comme
réussie. Le proxy relaie chaque ligne sans tampon et désactive la mise en
tampon Nginx avec `X-Accel-Buffering: no`.
Le délai de connexion est de 5 secondes. L'attente des en-têtes HTTP et
l'inactivité réseau peuvent durer jusqu'au budget de génération de 45 secondes :
une réponse démarrant après 15 secondes n'est plus coupée prématurément.
Le budget de génération est vérifié à chaque ligne reçue
(une lecture inactive peut ajouter au plus son délai réseau).
Les événements de maintien de connexion ne prolongent pas ce budget.

Les traces `Connexion Claude établie` et `Premier texte Claude reçu`
distinguent l'attente de la connexion de celle du début du texte.
`Appel Claude démarré` indique le mode effectif avant l'attente,
et `Appel Claude terminé` indique sa durée et son statut. Les erreurs restent explicites (503),
sans nouvelle tentative automatique payante, réponse partielle présentée
comme complète ni changement de fournisseur.
Une modification de ce réglage dans `.env` demande de recréer le backend :
`docker compose up -d --no-deps --force-recreate chatbot-backend`.

## Carte et interface du chatbot

La navigation principale est la seule barre laterale. Son en-tete salue
l'utilisateur ; le menu deroulant du chatbot contient Conversation et Nouvelle
conversation. L'engrenage Parametres est dans la navigation principale, sous
Appels : theme, notifications et acces aux preferences de l'assistant.
Le bouton en haut de la barre permet de la retracter
ou de la deployer ; ce choix est memorise dans le navigateur.
Le choix clair/sombre se trouve dans Parametres > Apparence et s'applique
a toute l'application. Le chatbot reprend la palette verte de la navigation.
Les informations du technicien sont en haut du chat, a cote du
Chat vocal. Le panneau de contexte et les liens Diagnostic / Ajouter une
intervention ont ete retires du chat integre. La conversation, les suggestions,
les photos, la voix et les preferences restent disponibles.

Un clic sur un point ouvre son menu : Demander l'itineraire, puis Modifier
et Supprimer si l'utilisateur en a le droit. La localisation et le calcul ne
demarrent qu'apres le choix de l'itineraire.
La carte trace les itineraires avec OpenRouteService.
Renseigner `MAIN_APP_MAP_ROUTING_API_KEY` dans `.env`, puis reconstruire les
images avec `docker compose up -d --build`. Pour un changement de cle seul :
`docker compose up -d --no-deps main-app-map`.
Sans cle, les points et le fond de carte fonctionnent toujours ; le panneau
d'itineraire indique explicitement que le service n'est pas configure.

Modes : a pied, velo, voiture et moto (profil voiture, sans contraintes
specifiques aux motos). Choix entre distance la plus courte et temps le plus
court. Le depart peut etre la position GPS autorisee par le navigateur, ou
un clic manuel sur la carte. La geolocalisation exige HTTPS ou localhost.
Seules les coordonnees du trajet sont transmises au fournisseur ; la cle
reste cote serveur et les trajets ne sont pas enregistres en base.

## Lancement local en une commande (Windows / WSL)

Depuis PowerShell, avec WSL et Docker Compose **2.24.4 ou plus** dans la distribution :

```powershell
.\start.ps1
```

Depuis WSL : `bash start.sh`.

Le lanceur construit les images, applique les migrations manquantes, démarre tous
les modules et attend leur disponibilité. Il affiche ensuite les liens exacts et
les ports : application, connexion, administration, chatbot, API et PostgreSQL.
Les ports par défaut sont **8080**, **8000** et **5433**, accessibles uniquement
depuis cette machine. Les autres services restent sur le réseau Docker interne.

- Le fichier `.env` existant est conservé ; seuls les paramètres locaux manquants
  sont ajoutés. Il faut renseigner `DATABASE_URL`, `VOYAGE_API_KEY` et la clé du
  fournisseur `LLM_PROVIDER` (`CLAUDE_API_KEY` ou `GEMINI_API_KEY`).
- La base `atm-chatbot_pgdata` et les pièces jointes existantes sont réutilisées :
  aucune remise à zéro, aucun seed de démonstration ni appel IA au démarrage.
- S'il existe déjà un administrateur actif, son compte reste inchangé. Sinon,
  le compte `admin` est créé avec un mot de passe aléatoire dans
  [`.local/initial-admin.json`](.local/initial-admin.json), ignoré par Git.
  Lire ce fichier localement, se connecter, changer le mot de passe dans
  **Mon compte**, puis supprimer ce fichier. Ne jamais le partager ni le committer.
  Si `admin` est déjà pris par un compte non administrateur, le lancement échoue
  explicitement sans modifier ce compte : utiliser la création interactive ci-dessous.
- Les techniciens sont créés ensuite dans **Administration → Comptes**.
- Ce mode reste du **développement local HTTP**, sans certificat ni configuration
  de production : connexion obligatoire, inscription libre désactivée, cookies
  non Secure autorisés uniquement dans ce mode. Le rechargement du backend Python
  est conservé ; les modifications des images Node nécessitent de relancer.
- Le GPU n'est pas requis pour les API Voyage / Claude / Gemini. L'image Python
  existante est réutilisée, ou construite si absente. Après modification de
  `requirements.txt` ou `Dockerfile.base`, lancer `.\start.ps1 --rebuild-base`.

```powershell
.\start.ps1 status  # Etat de tous les services
.\start.ps1 logs    # Journaux (Ctrl+C pour quitter, les services restent actifs)
.\start.ps1 stop    # Arret sans suppression des donnees
```

Pour changer les ports, définir `MAIN_APP_GATEWAY_PORT`, `CHATBOT_API_PORT` et/ou
`DB_PORT` dans `.env`, puis relancer. L'origine WebSocket des appels suit
automatiquement le port de l'application. Les ports réellement publiés sont
relus depuis Docker avant affichage ; un conflit de port arrête le lancement.

La configuration locale superpose
[`docker-compose.local.yml`](docker-compose.local.yml) aux deux fichiers Compose
existants, avec le même nom de projet `atm-chatbot`. Ne pas utiliser `down -v` :
cela supprimerait la base et les pièces jointes.

Création interactive d'un administrateur supplémentaire depuis WSL :

```bash
docker compose -p atm-chatbot -f compose.backend.yaml -f docker-compose.main-app.yml -f docker-compose.local.yml exec main-app-auth node src/jobs/createAdmin.js
```

La préparation d'un vrai déploiement HTTPS/Linux reste une étape ultérieure.

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
   base. Avec Claude, des points de cache (1 h) sont places sur la consigne
   systeme fixe et les anciens messages. Le cache ne s'applique qu'aux prefixes
   identiques atteignant le seuil du modele : sa presence dans la requete ne
   garantit pas un cache hit. La premiere ecriture 1 h coute 2 fois le tarif
   d'entree normal ; les lectures sont reduites selon le modele (5 % sur
   Sonnet 5.5, 10 % sur plusieurs autres modeles). Le dernier message reste
   hors cache. Les traces `[LLM]` donnent le modele reel, la duree HTTP, les
   tokens lus/ecrits en cache, les tokens non caches, la sortie, le raisonnement
   et la raison d'arret, sans contenu des messages ni cle API.
   Claude utilise une sortie JSON contrainte par le schema de comprehension,
   puis la validation metier reste appliquee. Le premier appel avec un schema
   peut demander une compilation supplementaire cote fournisseur.
   Il renvoie une intention, des
   références textuelles et, hors diagnostic, sa réponse. Si sa sortie est
   invalide, une erreur explicite est remontée (HTTP 503), sans deviner.
   **Photo jointe** (Claude uniquement, `photo_ocr_service.py`) : la photo part
   avec ce même appel ; Claude lit le texte affiché, en donne la signification
   et, s'il décrit une panne, l'ajoute aux `symptoms`. Une photo seule (sans
   texte) est acceptée. La photo n'est jamais enregistrée, seul le texte lu
   l'est. Désactivation : `PHOTO_OCR_ENABLED=false` dans `.env`.

   Configuration du modele : une seule affectation, par exemple
   `CLAUDE_MODEL=claude-sonnet-5-5`, jamais
   `CLAUDE_MODEL=CLAUDE_MODEL=...` (desormais rejete au demarrage).
   Une modification de `.env` exige `docker compose up -d --no-deps --force-recreate chatbot-backend`.
   Une API payante ne garantit pas une reponse instantanee : nombre de tokens
   generes, raisonnement, charge et reseau interviennent ; le cache accelere
   la lecture du prefixe, pas la generation de la reponse.
   Le message 503 parle d'indisponibilite, pas de saturation supposee.
4. Selon l'intention :
   - conversation (tout ce qui n'est pas une nouvelle panne : suivi, question
     générale…) : la réponse du LLM est renvoyée telle quelle, sans second appel
     ni recherche vectorielle. Le résultat dont il parle (`result_position`) est
     vérifié puis retenu comme `selected_result` ;
   - demande de détail sur un cas (« détaille le cas 2 »,
     `case_detail_requested`) : le cas est retrouvé en base par son
     `intervention_id`, **toutes** ses tables sont relues (résumé, appareil et
     modèle, tous les symptômes, résultat détaillé de chaque action, cause,
     **pièce en cause**), et un second appel LLM développe ce dossier
     (`case_detail_service.py`). La pièce en cause enregistrée doit être citée ;
     absente, elle n'est jamais inventée ;
   - diagnostic : résolution SQL des références, puis **un embedding par
     symptôme** listé par le LLM (`symptoms`, numérotés ; un seul appel groupé
     à Voyage), une recherche vectorielle par symptôme filtrée par type
     d'appareil (et modèle s'il est cité) et seuil de pertinence, regroupement
     par intervention (un cas peut recouper plusieurs symptômes et passe alors
     devant), préparation des cas réels, puis synthèse LLM. Le prompt demande au LLM
     de vérifier leur pertinence technique, d'écarter les cas sans lien établi
     et de signaler si aucun ne convient. Les pistes indirectes doivent expliquer
     leurs limites. Les suggestions générales sont introduites brièvement par
     « En complément, voici mes conseils de chatbot », sans inventer de faits
     historiques ni de fiabilité. Ces consignes sont communes à Gemini et Claude.
     Ce contrôle porte sur la réponse :
     les candidats mémorisés dans le contexte restent inchangés.
     Les consignes fixes de synthese des cas et des statistiques sont egalement
     separees du contexte variable et marquees pour le cache Claude (meme seuil
     minimal) ; les donnees des cas restent dans le message du tour.
5. Sans cas réel, le diagnostic tente les statistiques agrégées. Sans résultat,
   le LLM est appelé pour proposer des vérifications explicitement identifiées
   comme des conseils du chatbot après une phrase signalant l'absence de résultat,
   sans avertissement répétitif. Une panne
   fournisseur continue de remonter en erreur, sans réponse de secours.
6. L'orchestrateur sauvegarde la réponse et le contexte, valide la transaction,
   puis la route retourne `{conversation_id, reply}`.

Le type d'appareil et le nom de modèle cité filtrent la recherche vectorielle ;
le code d'erreur est mémorisé mais ne la filtre pas encore.
Une panne de pgvector est remontée sans calcul Python de secours. La recherche autonome
`GET /api/error_code/search` utilise SQL ILIKE, sans embedding ni LLM.

Les menus de suggestions de l’ATM-Chatbot répondent aussi sans IA, avec des réponses enregistrées en base (migration 0011) :

| Route | Rôle |
| --- | --- |
| `GET /api/usual_problem?device_type=gab` | pannes fréquentes de l'équipement (table `panne_frequente`) |
| `GET /api/usual_problem/{id}/solution` | réponse enregistrée d'une panne fréquente |
| `GET /api/error_code?device_type=gab` | codes d'erreur ayant une réponse enregistrée (`code_erreur.device_type` et `code_erreur.reply`) |
| `GET /api/error_code/{id}/solution` | réponse enregistrée d'un code d'erreur |

Pour les deux listes, `device_type` est obligatoire : les espaces en bordure
sont retirés et la casse est normalisée (`TPE` ou ` GAB ` sont acceptés).
Toute valeur autre que `gab` ou `tpe` après normalisation est refusée en HTTP 422.

Les administrateurs les gèrent dans `admin.html` (rubriques « Codes d'erreur » et « Pannes fréquentes »), via des routes protégées par `ADMIN_API_KEY` (en-tête `X-Admin-Key`) :
`GET`/`POST /api/admin/error_code`, `PUT`/`DELETE /api/admin/error_code/{id}`, et de même pour `/api/admin/usual_problem`. Un code cité par une proposition de solution ne peut pas être supprimé (409) : vider sa réponse le retire de l’ATM-Chatbot.

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

Lanceur local (dans WSL, sans démarrer Docker ni appeler les IA) :
`python3 -B -m unittest discover -s tests -p test_local_startup.py -v`

`python -m pytest tests/test_device_type_query.py -q`

Ce test couvre la normalisation et la validation HTTP des deux menus, sans base
de données, ainsi que leur contrat OpenAPI.

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
`solution_proposal_available: true` et l’ATM-Chatbot affiche « Aucune de ces
solutions ne fonctionne », puis « Proposer une solution ».

1. `GET /api/chat/conversations/{id}/solution-proposal-context?technician_id=`
   relit le problème actif dans `contexte_conversation` (dernière recherche,
   résultat sélectionné sinon le premier) et le renvoie pour affichage.
   409 si aucun problème n'est identifié, 403 si la conversation appartient
   à un autre technicien.
2. `POST /api/chat/conversations/{id}/solution-proposals` ne reçoit que
   l'action, le résultat et `outcome_status`. Le backend relit le contexte,
   crée une ligne `proposition_solution` (statut `pending`, migration 0009) avec
   un `conversation_context_snapshot`, et ajoute la confirmation à l'historique.
3. Page `admin.html`, routes `/api/admin/solution-proposals` protégées par
   `ADMIN_API_KEY` (en-tête `X-Admin-Key`) : approuver ou rejeter. Une
   approbation ajoute l'action au catalogue `action`, ou réutilise une action
   équivalente (distance <= `ACTION_CATALOG_MATCH_MAX_DISTANCE`, 0.15).
   L'approbation rattache aussi la solution au problème : une ligne
   `action_intervention` est ajoutée à l'intervention de référence, avec
   `targets_symptom_id` = le symptôme du problème (déjà vectorisé, aucun
   embedding recalculé) et `source_proposal_id` (migration 0010), puis les
   statistiques sont recalculées. Le chat la présente à part : « Solution
   ajoutée ensuite, proposée par … et validée par un administrateur ».
   Une décision est définitive ; un rejet exige un commentaire.

Le « cas de référence » (intervention, symptôme, composant) est le cas passé
auquel la recherche a rattaché le problème : la conversation n'est pas encore
liée à une intervention en cours, donc `device_id` reste vide.

## Ajout d'intervention

Pour ajouter à l'historique un problème que l’ATM-Chatbot ne connaît pas, avec
tout ce que le technicien a fait. Rien n'est visible dans la recherche avant
la validation d'un administrateur.

1. `POST /api/intervention_add` : le technicien envoie l'appareil (`device` :
   `device_id`, ou `serial_number`, `device_type`, `model_name`, `site_name`,
   `address`), `final_outcome_status`, les `symptoms`, les `actions` dans
   l'ordre (`targets_symptom_number` = n° du symptôme visé, 1 = le premier ;
   `performed_at` facultatif) et, s'il l'a trouvée, la cause (`diagnosis`),
   avec la pièce en cause en texte libre (`root_cause_component_text`, aucune
   liste à respecter, migration 0013).
   L'appareil existant est cherché par `device_id`, sinon `serial_number`,
   sinon type + modèle + site (`model_name` est cherché dans `modele_appareil`).
   S'il n'existe pas, il sera **créé à l'approbation**, avec son modèle s'il
   est absent de `modele_appareil` ; `device_type` est alors obligatoire. La
   recherche est refaite à l'approbation : rien n'est créé en double.
   Une ligne `ajout_intervention` est créée (statut `pending`, migration 0012).
   Règles vérifiées (sinon 422) : une intervention `resolved` a une action
   `is_confirmed_solution`, qui a `outcome_status = resolved`, et inversement.
   `GET /api/intervention_add?technician_id=` liste ses demandes.
2. Routes `/api/admin/intervention_add` (clé `X-Admin-Key`) :
   - `GET /{id}` : contenu actuel et envoi d'origine (`submitted_content`, jamais modifié) ;
   - `GET /{id}/preview` : **ce que l'approbation écrira, table par table**
     (`intervention`, `symptome_intervention`, `action_intervention`,
     `diagnostic`, nouvelles entrées des catalogues `symptome` et `action`).
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

L’ATM-Chatbot expose le formulaire technicien depuis le menu gauche et sous les
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
docker compose up -d --build
```

Claude est le fournisseur par défaut ; `LLM_PROVIDER=gemini` reste possible.