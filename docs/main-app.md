# Main app : l'application des techniciens

L'**Espace techniciens** est la deuxième application du dépôt, à côté du chatbot de diagnostic.
Elle permet aux techniciens de terrain de :

- **partager une carte** des lieux utiles : sites de GAB, clients équipés d'un TPE, dépôts de pièces, accès difficiles ;
- **échanger des messages** : texte, photos et messages vocaux ;
- **s'appeler** en audio, de navigateur à navigateur.

Elle tourne en **Node.js + Express**. Son code est dans `main-app/`, séparé du chatbot (Python), qui ne change pas.

---

## Paramètres et notifications web

- **Paramètres** (engrenage sous **Appels**) ouvre un panneau global depuis chaque page, sans recharger le chatbot ni perdre sa conversation. Le sous-menu **ATM-Chatbot** du groupe Fonctionnalités contient **Nouvelle conversation** et **Voir les conversations**. Le sous-titre « Application des techniciens » n'est plus affiché sous la salutation.
- Une seule fenêtre défilante aligne **Apparence**, **Notifications** et tous les paramètres **Chat** d'origine (avatar, voix, conversation), sans accordéons. Le titre et le bouton Fermer restent visibles pendant le défilement. Le formulaire et le contrôleur du frontend sont réutilisés, sans seconde fenêtre ni navigation. Les choix sont enregistrés immédiatement sur cet appareil et synchronisés avec le chatbot ouvert, sans perdre son brouillon. L'ancien lien `/atm-chatbot/#settings` ouvre aussi cette fenêtre.
- Le test de voix appelle les routes authentifiées `/atm-chatbot/app/tts` depuis toute page. La CSP autorise les médias du même site et les URL `blob:` nécessaires à leur lecture, sans élargir les origines de scripts.
- Le **badge Messagerie** reste visible dans le rail réduit. Une carte avec une icône de message, un titre, le nombre de non-lus et un accès à la conversation annonce les arrivées. La notification système utilise également une icône de messagerie. Le polling global interroge `GET /api/messaging/notifications` toutes les 10 secondes, sans récupérer de contenu de message. Le premier état n'annonce pas les anciens messages, et les messages envoyés par soi-même sont exclus.
- Les **non-lus sont conservés en base** via les accusés de lecture existants, par participant : recharger la page ne les efface pas. Le fil n'envoie l'accusé qu'une fois réellement visible, dans un onglet actif, arrivé en bas. Le serveur refuse les identifiants de message d'une autre conversation ou inexistants ; un ancien accusé ne peut pas faire reculer la lecture.
- Les notifications du **navigateur sont désactivées par défaut**. Le bouton d'activation dans Paramètres demande explicitement la permission système ; refus, absence de support et besoin de HTTPS sont signalés. Aucun contenu privé n'est affiché dans la notification système. Désactiver ce bouton n'enlève ni les badges ni les alertes dans l'application. Le choix est mémorisé par utilisateur et navigateur ; les autorisations du site se révoquent aussi dans le navigateur.
- Les curseurs d'alerte sont mémorisés localement par utilisateur. Les navigateurs disposant de Web Locks dédupliquent les alertes entre onglets ; sinon la déduplication locale est au mieux. Si le stockage local est bloqué, le badge serveur reste fiable, mais les curseurs ne survivent pas au rechargement.

**Limite actuelle : application web ouverte uniquement.** Le navigateur peut ralentir ou suspendre un onglet caché. Il n'y a ni service worker push, ni notification garantie après fermeture du site, ni intégration Android native. Des notifications Android réellement en arrière-plan, de type WhatsApp, nécessiteront un projet distinct (push, enregistrement des appareils, application/service worker et gestion de livraison) ; cette version ne les prétend pas disponibles.

### Historique ATM-Chatbot

**Voir les conversations** ouvre l'historique PostgreSQL du compte connecté, par pages de 30, de la conversation la plus récente à la plus ancienne. Sélectionner une conversation restaure tous ses messages enregistrés, son appareil GAB/TPE et son contexte serveur ; la question suivante poursuit le même échange. La simple consultation n'appelle pas le modèle et ne modifie pas le contexte. **Nouvelle conversation** vide seulement l'échange actif, sans supprimer les anciens.

Les routes `GET /api/chat/conversations` et `GET /api/chat/conversations/{id}` utilisent l'identité authentifiée transmise par le gateway et filtrent le propriétaire. Une conversation absente ou appartenant à un autre compte renvoie le même 404. Le cache d'onglet est également isolé par technicien ; l'ancien cache non identifié n'est pas réattribué à un compte.

L'historique restitue ce qui a été enregistré par l'API : les photos originales et les échanges purement locaux (réponses rapides, confirmations de formulaire) ne sont pas conservés en base et ne peuvent pas être reconstruits.

## Navigation d'administration

### Codes d'erreur réels et fichiers JSON

Le dossier `db/code_erreurs` contient un fichier `<catalog_number>.json` par code, avec un numéro de catalogue entier indépendant de la clé primaire SQL, code **texte** (pour conserver `01`), libellé, équipement, réponse et documentation : module, composant, source/page, famille et cassette éventuelles. Aucun ID SQL n'est stocké dans ces JSON. Le premier corpus contient **68 codes/messages CMD-V4 (142, 153)** issus de `CMD V4_ET_MAJ.pdf` (pages 5 à 11), dont les 36 valeurs concrètes `31` à `36`, `41` à `46`, …, `81` à `86`, ainsi que les messages contrôleur B0/C0 prescrivant le SAV. Aucun joker n'est recherché ou interprété par le chatbot. Les états normaux et les fonctions de test/RESET/firmware ne sont pas importés comme des erreurs.

Le document vise le **module CMD-V4**, pas un modèle unique de GAB. CINEO C2550 / ProCash 8050 sont cités dans la consigne du code 09 seulement. Le corpus ne suppose pas de compatibilité avec tous les GAB. Les mesures sont reformulées sans inventer d'intervention réussie ; les procédures externes absentes et les formulations ambiguës restent signalées.

Après les migrations `0021_error_code_documents.sql` et `0022_error_code_numbers_and_messages.sql`, chargement depuis la racine :

```powershell
python -m scripts.load_error_codes
```

Avec le déploiement Docker local :

```powershell
wsl -d Ubuntu -- docker compose -f compose.yaml exec -T chatbot-backend python -m scripts.load_error_codes
```

L'option `--replace-demo` retire **uniquement** les anciennes entrées connues E42/E43/E67 (ID 1/2/3, libellé et panne d'origine vérifiés). Une référence par une proposition, une entrée modifiée ou un conflit fait échouer la transaction sans suppression partielle. Ni les pannes liées, ni les pannes fréquentes, ni les interventions ne sont supprimées. Les seeds ne recréent plus ces codes fictifs.

L'import valide tous les fichiers et retrouve les lignes par `catalog_number` ; il peut être rejoué sans changer leurs ID. PostgreSQL attribue seul `error_code_id` via sa séquence. La migration conserve les ID existants et leurs références. Pour un ajout admin, seul le numéro de catalogue est calculé par `MAX(catalog_number) + 1`. Import et administration partagent un verrou de table pour éviter les collisions concurrentes des numéros/fichiers. Les suppressions ne renumérotent pas les autres entrées ; un ID SQL peut avoir des trous et ne sert jamais de compteur.

L'administration écrit atomiquement le JSON **avant** le commit SQL. Une erreur disque bloque l'enregistrement ; un échec SQL restaure le JSON précédent. Modification et suppression suivent le même mécanisme. Les métadonnées source sont modifiables dans le formulaire, et celles non affichées (famille, cassette, notes) sont conservées. Les fichiers sont montés depuis l'hôte dans `chatbot-backend` et `init-db`, donc survivent aux recréations des conteneurs. Une coupure brutale entre les deux écritures n'est pas une transaction distribuée : vérifier le JSON concerné puis relancer l'import pour réconcilier la base.

Dans le chat, Claude renseigne `error_code_text` dans son JSON de compréhension, y compris pour un code lu sur une photo. Le backend cherche une correspondance exacte (casse ignorée, zéros initiaux conservés) pour l'équipement choisi et renvoie la réponse enregistrée **sans second appel à Claude, embedding ni recherche d'interventions**. Sans consigne, il le dit explicitement au lieu d'inventer une procédure. Le code détecté et sa clé étrangère éventuelle sont enregistrés avec les deux messages ; la référence et sa consigne entrent dans le contexte envoyé aux échanges suivants. Un nouveau code inconnu efface l'ancienne référence, et un nouveau diagnostic sans code quitte ce contexte.

Le choix manuel passe par `POST /api/chat/error-code` : même persistance et même contexte, mais **aucun appel à Claude**. L'historique restauré conserve ces références. Sur téléphone (largeur du chat ≤ 760 px), le bouton ouvre un dialogue modal central, filtrable et défilant, avec fermeture accessible et arrière-plan flouté ; le menu des pannes fréquentes reste inchangé. Sur grand écran, le menu déroulant est conservé.

Pour les administrateurs, **Administration** est le premier groupe de la barre principale, avant les outils des techniciens. Ses liens directs sont Comptes, Propositions, Ajouts d'intervention, Codes d'erreur et Pannes fréquentes, sans menu déroulant. La page `/admin/` n'a plus de seconde barre latérale ; les compteurs et la rubrique active figurent dans le groupe Administration. Les liens `/admin/#<rubrique>` et l'historique du navigateur restent utilisables. Les autres rôles ne voient pas ce groupe et les protections serveur restent inchangées.

### Ajouter directement une intervention

Dans **Administration → Ajouts d'intervention**, le bouton **+ Ajouter** ouvre la saisie directe : type GAB/TPE, modèle/site/numéro de série facultatifs, **1 à 20 symptômes** et **1 à 30 actions** avec résultat, état final et diagnostic facultatif. Chaque action peut viser tous les symptômes ou un symptôme précis. Une intervention résolue doit avoir au moins une solution confirmée ayant réglé le problème.

L'enregistrement est immédiatement approuvé avec **origine admin** et le compte connecté comme auteur ; il n'attribue ni technicien ni conversation et ne demande aucune date de visite. La date technique de création n'est pas présentée au chatbot comme une date de visite. Les symptômes sont indexés, les catalogues enrichis et les statistiques recalculées dans la même transaction : un échec annule l'écriture complète et le formulaire conserve la saisie. Les demandes des techniciens gardent leur circuit habituel de validation.

La migration `0020_admin_interventions.sql` permet cette provenance distincte et impose sa cohérence en base. Le navigateur appelle `POST /api/atm-chatbot-admin/intervention_add` ; le gateway contrôle la session admin, injecte la clé serveur et **remplace** l'en-tête `X-Authenticated-Admin-Username` par l'identité authentifiée. La route backend `POST /api/admin/intervention_add` refuse une identité manquante/invalide, une provenance fournie dans le JSON ou des dates de visite non nulles.

## Thème GAB et orientation mobile

Les dimensions de navigation se règlent dans les variables `--sidebar-*` de `main-app/gateway/html/shared/css/base.css` : libellés de 17 px environ, icônes de 22 px, espacement de 12 px entre options et séparation accrue avant Réduire/Déconnexion. Le rail réduit garde des espacements compacts et les longues listes restent défilables.

La marge intérieure supérieure du rail est de 30 px (`--sidebar-padding-top`). Son fond vitré utilise un dégradé diagonal marron léger distinct des cartes blanches, adapté au mode sombre avec `--sidebar-background`. La déconnexion est orange dans tous les thèmes (`--sidebar-logout-color`), sans changer les couleurs des erreurs ni sa confirmation.

L'application et le chatbot gardent une base **blanche avec des textes gris neutres**. Le marron remplace le vert uniquement sur les accents : boutons principaux, sélection, icônes et bordures de focus discrètes. Les cartes, bulles de conversation et champs restent blancs, sans teinte sépia ; le mode sombre utilise des gris neutres. La photo de fond et les surfaces vitrées sont conservées. Les modes **Clair**, **Sombre** et **GAB · Marron & Crème** restent disponibles ; le choix est mémorisé et synchronisé avec le chatbot sans le recharger. Le mode GAB conserve son identifiant `gab` pour préserver les préférences existantes. Les erreurs et la déconnexion restent rouges, les confirmations restent vertes et les catégories de la carte gardent leurs couleurs fonctionnelles.

La sidebar GAB est translucide ; **Réduire le menu** est en bas, au-dessus de la déconnexion. Le sous-menu du chatbot utilise une surface claire vitrée en thème clair/GAB et neutre sombre en thème sombre. En rail réduit, il s'ouvre au-dessus du défilement dans un panneau natif, fermable avec Échap ou un clic extérieur. Les sélecteurs restent natifs pour conserver clavier, groupes de voix et accessibilité : leur liste utilise `appearance: base-select` sur les navigateurs compatibles, sinon le sélecteur système reste disponible.

L'image est dans `main-app/gateway/html/shared/images/gab-background.svg`. Pour la remplacer, gardez ce nom ou changez uniquement l'URL `--page-background-image` du bloc `[data-theme="gab"]` dans `main-app/gateway/html/shared/css/base.css` (JPEG/PNG acceptés). Reconstruisez ensuite `main-app-gateway`.

Sur mobile en **portrait**, le rail d'icônes est vertical à gauche. En **paysage compact** (hauteur ≤ 600 px), les onglets sont horizontaux en bas. Les sous-menus restent accessibles et les paramètres défilent dans leur propre panneau.

---

## 1. Lancer, arrêter, observer

```bash
# Tout lancer (chatbot + main app). Le fichier du chatbot reste inchangé.
docker compose -f compose.backend.yaml -f docker-compose.main-app.yml up -d --build

# Premier administrateur (saisie interactive, mot de passe masqué)
docker compose -f compose.backend.yaml -f docker-compose.main-app.yml exec main-app-auth node src/jobs/createAdmin.js
```

L'app s'ouvre sur `http://localhost:8080` (variable `MAIN_APP_GATEWAY_PORT`).

Chaque fonctionnalité a son conteneur : on peut l'arrêter ou le relancer seul.
Les services Node et le job DB partagent `atm-main-app:latest`, construite uniquement
par `main-app-auth` pour eviter les exports concurrents vers le meme nom.
Apres une modification Node, lancer `docker compose build main-app-auth`, puis
`docker compose up -d --no-deps --no-build <service>` pour le service concerne.
Le lancement global `docker compose up -d --build` reste une seule commande.

| Action | Commande (préfixe : `docker compose -f compose.backend.yaml -f docker-compose.main-app.yml`) |
|---|---|
| Arrêter / relancer | `stop <service>` · `start <service>` · `restart <service>` |
| Reconstruire Node après une modification | `build main-app-auth`, puis `up -d --no-deps --no-build <service>` |
| Reconstruire la passerelle | `up -d --build --no-deps main-app-gateway` |
| Suivre les journaux | `logs -f <service>` |
| État | `ps` |

Services : `main-app-gateway`, `main-app-auth`, `main-app-map`, `main-app-messaging`, `main-app-calls`. Il y a aussi le job ponctuel `main-app-database-setup`.

**Clés à ajouter dans `.env`** (modèle complet dans `.env.example`) :

| Clé | Obligatoire | Rôle |
|---|---|---|
| `MAIN_APP_DATABASE_PASSWORD` | **oui** | Mot de passe du rôle SQL `main_app_user` (16 caractères ou plus ; par exemple `openssl rand -hex 24`) |
| `MAIN_APP_MAP_TILE_URL_TEMPLATE` | **oui** | Gabarit du fournisseur de tuiles, par exemple `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| `MAIN_APP_MAP_TILE_USER_AGENT` | **oui** | Identifiant de l'app auprès du fournisseur : nom et contact, exigés par OpenStreetMap |
| `MAIN_APP_PUBLIC_ORIGIN` | en production | Adresse publique exacte, par exemple `https://techniciens.exemple.fr`. Par défaut : `http://localhost:8080` |
| `MAIN_APP_COOKIE_SECURE` | — | `true` par défaut. `false` est permis uniquement avec `MAIN_APP_ENVIRONMENT=development`, pour tester en HTTP |
| `MAIN_APP_ALLOW_REGISTRATION` | — | Inscription libre, `false` par défaut |
| les autres `MAIN_APP_*` | — | Valeurs par défaut raisonnables (voir `.env.example`) |

> **Tester en local en HTTP** : mettre `MAIN_APP_ENVIRONMENT=development` et `MAIN_APP_COOKIE_SECURE=false`. Sinon le cookie `Secure` n'est pas renvoyé par certains navigateurs. Le micro (messages vocaux, appels) et la géolocalisation exigent HTTPS, sauf sur `localhost`.

---

## 2. Séparation avec le chatbot

Les deux applications n'ont **aucun code commun**. Elles sont reliées par trois points seulement :

1. **La base PostgreSQL** (détails ci-dessous).
2. **L’ATM-Chatbot** : le gateway sert le frontend du chatbot (service `chatbot-frontend`, sans port publié) sous `/atm-chatbot/app/`, aux seuls utilisateurs connectés. L'onglet `/atm-chatbot/` l'affiche dans une iframe du même site (`atm-chatbot.html?embedded=1&theme=…&technician_id=…`) ; en mode intégré (`frontend/public/js/embeddedMode.js`), le chatbot masque sa barre du haut et suit le thème de l'Espace techniciens (`postMessage`, même origine seulement).
   - `auth_request` interroge `GET /api/auth/internal/session-check` (conteneur auth) : 204 avec l'en-tête `X-Authenticated-Technician-Id`, sinon 401 ;
   - le gateway pose `X-Authenticated-Technician-Id` et `X-Atm-Chatbot-Gateway-Secret` (valeur de `ATM_CHATBOT_GATEWAY_SHARED_SECRET`), en écrasant ceux du client ; `frontend/server.py` les recopie vers l'API ;
   - l'API du chatbot (`app/core/gateway_identity.py`), quand ce secret est configuré, refuse (401) toute requête sans le bon secret, sauf `/health`, la documentation et `/api/admin/` (clé propre), et remplace le `technician_id` reçu par celui de la session ;
   - CSP propre à `/atm-chatbot/app/` : iframe du même site (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`), Google Fonts, micro autorisé ; toujours aucun script en ligne.
3. **L'administration de l’ATM-Chatbot** (rubriques de `/admin/`) : le gateway relaie `/api/atm-chatbot-admin/<chemin>` vers `/api/admin/<chemin>` de l'API du chatbot :
   - `auth_request` interroge d'abord `GET /api/auth/internal/administrator-check` (conteneur auth) : 204 pour un admin connecté, sinon 401/403 renvoyés tels quels au navigateur ;
   - le gateway ajoute lui-même l'en-tête `X-Admin-Key` (valeur de `ADMIN_API_KEY`, passée au gateway sous le nom `MAIN_APP_CHATBOT_ADMIN_API_KEY`) : la clé n'arrive jamais dans le navigateur, et celle qu'un client enverrait est écrasée ;
   - pour cela, le service `chatbot-backend` du chatbot rejoint `main-app-network` sous l'alias `chatbot-api` (dans `docker-compose.main-app.yml`). Le gateway ne voit toujours pas la base ;
   - la clé et le secret sont écrits au démarrage dans `/tmp/atm-chatbot-settings.conf` à partir de `gateway/templates/atm-chatbot-settings.conf.template` (mécanisme `envsubst` de l'image nginx).

Si le chatbot est arrêté, l'onglet ATM-Chatbot affiche « service indisponible » et les rubriques ATM-Chatbot de l'administration affichent « ATM-Chatbot momentanément indisponible » ; le reste de l'Espace techniciens fonctionne normalement.

| Élément | Chatbot | Main app |
|---|---|---|
| Code | `app/`, `frontend/` | `main-app/` (son propre `.gitignore`, `.dockerignore`, ESLint) |
| Conteneurs | `compose.backend.yaml` (inchangé) | `docker-compose.main-app.yml` (nouveau fichier) |
| Tables | schéma `public` | schéma `main_app` |
| Migrations | `0001` à `0013` | `0014` à `0018`, dans le même dossier et appliquées par le **même mécanisme** (`init-db`) |
| Rôle SQL | `postgres` | `main_app_user` (droits restreints) |

### Tables partagées

`public.technicien` est la **table d'identité commune**. Chaque compte de la main app **est** une ligne de `technicien`.

| Table du chatbot | Accès de la main app | Utilisation |
|---|---|---|
| `public.technicien` | **SELECT** | Rattacher un compte à un technicien existant |
| `public.technicien` | **INSERT** (et la séquence `technician_technician_id_seq`) | Créer un compte avec un nouveau technicien |
| Toutes les autres | **aucun** | — |

À la création d'un compte, la ligne de `technicien` est **minimale** :
- `full_name` est la seule colonne obligatoire. On y met le nom complet saisi, ou le nom d'utilisateur à défaut.
- `active` prend sa valeur par défaut (`TRUE`).
- `employee_code`, `email`, `phone` et `region` restent vides (NULL). Le modèle SQLAlchemy du chatbot déclare `employee_code` obligatoire, mais la colonne accepte NULL en base (migration 0001). Le chatbot n'en dépend pas pour ses recherches.

La main app ne fait **jamais** d'`UPDATE` ni de `DELETE` sur les lignes du chatbot. Le rôle `main_app_user` n'en a d'ailleurs pas le droit. Aucune table existante n'est modifiée : pas d'`ALTER`, pas de nouvelle colonne, pas de contrainte.

Les clés étrangères vers `technician(technician_id)` (de type `INTEGER`, car `SERIAL`) sont :
- `accounts.technician_id` (`ON DELETE CASCADE`) ;
- `conversation_participants.technician_id`, `messages.sender_technician_id`, `call_logs.caller_technician_id` / `callee_technician_id` (`CASCADE`) ;
- `map_points.created_by` (`SET NULL` : un lieu utile reste sur la carte si son auteur disparaît).

### Tables de la main app (schéma `main_app`)

| Migration | Tables |
|---|---|
| `0014_main_app_schema.sql` | Schéma, extensions `citext`, `cube`, `earthdistance`, ENUM `account_role`, rôle `main_app_user` et ses droits |
| `0015_main_app_auth.sql` | `comptes`, `sessions`, `blocages_connexion` |
| `0016_main_app_map.sql` | `points_carte` (index GiST sur `ll_to_earth(latitude, longitude)`) |
| `0017_main_app_messaging.sql` | `conversations`, `participants_conversation`, `messages`, `pieces_jointes_message` |
| `0018_main_app_calls.sql` | `journal_appels` |

### Rôle SQL dédié et job `main-app-database-setup`

Le mécanisme de migration du chatbot (`init-db`, avec `psql`) ne reçoit pas les variables d'environnement de la main app. Le rôle est donc préparé en deux temps :
- la migration 0014 crée `main_app_user` **sans mot de passe** (`NOLOGIN`) et lui donne ses droits ;
- le job ponctuel `main-app-database-setup` (`src/jobs/configureDatabaseRole.js`) lui donne ensuite son mot de passe (`MAIN_APP_DATABASE_PASSWORD`) et le droit de se connecter.

Le job tourne après `init-db` et à chaque démarrage, ce qui applique aussi un changement de mot de passe. Il vérifie que les tables `main_app` existent bien. C'est le seul code de la main app qui utilise le compte d'administration (`DATABASE_URL` du chatbot). Les conteneurs permanents n'utilisent que `main_app_user`.

---

## 3. Conteneurs

```
navigateur ──► main-app-gateway (nginx, seul port publié)
                 ├── /auth/, /api/auth/            ──► main-app-auth
                 ├── /map/, /api/map/              ──► main-app-map ──► fournisseur de tuiles (HTTPS)
                 ├── /messaging/, /api/messaging/  ──► main-app-messaging (volume main-app-uploads)
                 ├── /calls/, /api/calls/ (+ ws)   ──► main-app-calls
                 └── /, /shared/                   (pages communes, servies par le gateway)
       auth, map, messaging, calls ──► db (PostgreSQL du chatbot)
```

- **Une seule image Node** (`main-app/Dockerfile`) ; seule la commande change selon le conteneur. Le gateway a sa propre image (nginx non-root).
- **Durcissement** de chaque conteneur :
  - utilisateur non-root, `read_only: true` (avec `tmpfs` sur `/tmp`) ;
  - `cap_drop: [ALL]`, `no-new-privileges` ;
  - `restart: unless-stopped`, `healthcheck` sur `/health` (qui vérifie aussi la base) ;
  - seulement les variables d'environnement utiles à ce conteneur.
- **Démarrage** : chaque conteneur applicatif attend la base, et le job qui prépare le rôle SQL. Il ne dépend **jamais** d'un autre conteneur de la main app. Le gateway ne dépend de personne.
- **Réseaux** :
  - le gateway est sur `main-app-network` uniquement : il ne voit ni la base ni le chatbot ;
  - les conteneurs Node sont sur `main-app-network` (pour le gateway) et sur le réseau du chatbot (uniquement pour joindre `db`) ;
  - aucun conteneur de la main app ne publie de port, sauf le gateway, publié par défaut sur `127.0.0.1` seulement.
- **Dégradation gracieuse** : nginx résout le nom de chaque conteneur à chaque requête. Si un conteneur est arrêté, sa fonctionnalité répond **503** : une page « service indisponible », ou un JSON pour `/api/`. Le gateway et les autres fonctionnalités continuent, et le chatbot n'est jamais concerné.
- **Sessions en base** : redémarrer `main-app-auth`, ou n'importe quel conteneur, ne déconnecte personne. Chaque conteneur vérifie la session lui-même, directement en base (`src/core/sessionStore.js`), même si `main-app-auth` est arrêté.

---

## 4. Structure du code

```
main-app/
├── Dockerfile  .dockerignore  .gitignore  .gitattributes  eslint.config.js  package.json  package-lock.json
├── gateway/        nginx.conf, snippets/ (security-headers.conf, proxy-common.conf), html/ (accueil, shared/, page indisponible)
│                   html/shared/ : base.css, fonts/, js/ (connectedPageShell, icons, domHelpers, apiClient, applySavedTheme…)
├── web/            pages de chaque fonctionnalité : auth/, map/, messaging/, calls/ (HTML/CSS/JS natif)
├── src/
│   ├── entrypoints/   auth.js, map.js, messaging.js, calls.js : un par conteneur
│   ├── routes/<f>/       URL -> middlewares -> controller
│   ├── controllers/<f>/  lit la requête, appelle le service, renvoie le JSON
│   ├── services/<f>/     logique métier, sans req/res
│   ├── models/<f>/       SQL paramétré ($1, $2...), seule couche qui parle à la base
│   ├── schemas/<f>/      validation zod de toutes les entrées
│   ├── middlewares/      PARTAGÉ : asyncHandler, errorHandler, requireAuthenticatedUser, requireRole
│   ├── core/             PARTAGÉ : config, database, errors, tracing, createFeatureApp, sessionStore, cookies, validation
│   └── jobs/             createAdmin, cleanupExpiredSessions, cleanupOrphanUploads, configureDatabaseRole
└── tests/unit/  tests/integration/
```

Règles :
- **Les fonctionnalités ne s'importent jamais entre elles.** Elles n'utilisent que `core/` et `middlewares/`. Deux contrôles le vérifient :
  - la règle ESLint `no-restricted-imports` ;
  - le test `tests/unit/architecture/featureIsolation.test.js`.
- **Exception assumée** : `core/sessionStore.js` contient du SQL hors de `models/`. Ce sont les tables de session, lues par **tous** les conteneurs pour vérifier la session sans dépendre d'auth.
- **Erreurs typées** (`core/errors.js`), les mêmes que le chatbot :

  | Erreur | Statut |
  |---|---|
  | `ReferenceNotFoundError` | 404 |
  | `InvalidReferenceError` | 422 |
  | `AccessDeniedError` | 403 |
  | `StateConflictError` | 409 |
  | `ExternalServiceUnavailableError` | 503 |

  S'y ajoutent les erreurs propres à une app avec comptes :

  | Erreur | Statut |
  |---|---|
  | `AuthenticationRequiredError` | 401 |
  | `TooManyAttemptsError` | 429 |
  | `PayloadTooLargeError` | 413 |

  Les réponses ont toujours la forme `{ error: { code, message } }`, sans pile d'appels.
- **Traces** : une ligne JSON par événement sur la sortie standard (`core/tracing.js`). Jamais de mot de passe, de token, de cookie ni de contenu de message.

### Interface

- **Même identité visuelle que le chatbot** : accent vert, cartes vitrées, police Plus Jakarta Sans (servie en local, licence OFL dans `gateway/html/shared/fonts/`).
- **Thème clair / sombre** :
  - bouton soleil | lune dans le rail ; le choix est mémorisé dans le navigateur, sinon le réglage du système s'applique ;
  - `applySavedTheme.js` pose `<html data-theme>` avant l'affichage, pour éviter un flash clair ;
  - toutes les couleurs sont des jetons en tête de `base.css` ;
  - en sombre, le fond de carte est assombri par un filtre CSS, car les tuiles n'existent qu'en clair.
- **Navigation** (`connectedPageShell.js`) :
  - rail à gauche sur ordinateur ;
  - icônes seules sur tablette ;
  - onglets en bas sur mobile, à portée de pouce.
- **Icônes** (`icons.js`) : du SVG construit avec `createElementNS`. Il n'y a ni fichier image ni `innerHTML`, donc rien qui gêne la CSP. Dans le HTML, `<span data-icon="map">` est remplacé au chargement.
- **Avatars** (`domHelpers.createAvatar`) : les initiales sur une couleur tirée du nom. La même personne garde la même couleur partout.
- **Les textes saisis par les utilisateurs restent insérés avec `textContent`.** Les épingles de la carte sont des éléments DOM passés à `L.divIcon`, jamais du HTML en texte.

---

## 5. Authentification

- Connexion par **nom d'utilisateur + mot de passe uniquement** : ni email, ni OAuth.
  - Le nom est en CITEXT (insensible à la casse) : 3 à 30 caractères `[a-zA-Z0-9_.-]`.
  - Le mot de passe fait 10 à 128 caractères et est haché en **argon2id** (19 Mio, 2 passes).
- **Sessions côté serveur** :
  - le cookie contient un token aléatoire de 32 octets ;
  - la base n'en garde que l'empreinte SHA-256 ;
  - cookie `HttpOnly`, `Secure`, `SameSite=Lax`, préfixe `__Host-` ;
  - expiration réglée par `MAIN_APP_SESSION_DURATION_HOURS` ;
  - déconnexion = suppression de la session.
- **Contre la découverte des comptes et la force brute** :
  - même message d'erreur que le compte existe ou non, et même s'il est désactivé ;
  - un mot de passe est toujours vérifié, contre une empreinte leurre si le compte n'existe pas : le temps de réponse est comparable ;
  - verrouillage temporaire après `MAIN_APP_LOGIN_MAX_FAILED_ATTEMPTS` échecs **par couple (nom saisi, IP)**, dans `blocages_connexion`. Le verrou est par couple plutôt que dans `comptes` : il fonctionne aussi pour un nom inexistant, et un attaquant ne peut pas bloquer un collègue depuis une autre adresse ;
  - `limit_req` nginx sur la connexion et l'inscription.
- **Rôles** :

  | Rôle | Droits |
  |---|---|
  | `technicien` | gère ses propres points |
  | `moderator` | gère tous les points |
  | `admin` | gère aussi les comptes et les rôles, et administre l’ATM-Chatbot (`/admin/`) |

  - Un admin ne peut pas modifier son propre compte depuis l'administration.
  - Il reste toujours au moins un admin actif.
- **Comptes** :
  - créés par un admin, rattachés à un technicien existant ou avec un nouveau technicien minimal ;
  - inscription libre seulement si `MAIN_APP_ALLOW_REGISTRATION=true` ;
  - pas de récupération par email : un admin réinitialise le mot de passe, ce qui ferme toutes les sessions du compte ;
  - désactiver un compte coupe ses sessions immédiatement.
- **Premier admin** : `node src/jobs/createAdmin.js`, en saisie interactive. Aucun mot de passe par défaut n'existe dans le code.
- **Connexion désactivée, pour le développement seulement** : `MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME=<nom d'un compte existant>`.
  - Une requête sans session valide agit alors en tant que ce compte, dans tous les conteneurs (API et WebSocket des appels). Une vraie session reste prioritaire : on peut encore tester à deux comptes.
  - Le compte doit exister et être actif ; sinon, rien ne change (401).
  - **Refusé au démarrage si `MAIN_APP_ENVIRONMENT=production`** : le conteneur s'arrête avec un message explicite.
  - Exemple `.env` de poste de développement : `MAIN_APP_ENVIRONMENT=development`, `MAIN_APP_COOKIE_SECURE=false`, `MAIN_APP_DEVELOPMENT_AUTO_LOGIN_USERNAME=alan_admin`.

---

## 6. Carte

- **Leaflet** gère l'interaction : marqueurs, bulles, clics. **MapLibre GL** dessine le fond, grâce au pont `@maplibre/maplibre-gl-leaflet`.
  - Les trois librairies sont installées par npm et **servies en local** par le conteneur map, depuis `node_modules`. Aucun CDN.
  - MapLibre 6 n'existe qu'en module ES. La page l'importe, puis l'expose en variable globale pour le pont (script UMD).
- **Droits** : tout utilisateur connecté voit tous les points. Un technicien modifie ou supprime **ses** points ; modérateurs et admins gèrent tous les points. Chaque point renvoyé porte `canModify`, et le serveur revérifie les droits à chaque écriture.
- **Catégories** : `atm_site` (site de GAB), `tpe_client` (client TPE), `parts_depot` (dépôt de pièces), `difficult_access` (accès difficile), `other` (par défaut).
- **Recherche géographique**, sans PostGIS :
  - `GET /api/map/points?south&west&north&east` : zone visible, qui gère aussi le passage de l'antiméridien ;
  - `GET /api/map/points/nearby?lat&lng&radius` : rayon de 50 km au plus, via `earth_box` (index GiST) puis `earth_distance`.
- **Relais des tuiles** : `GET /api/map/tiles/:z/:x/:y`, sous session.
  - Le gabarit d'URL est fixé dans `.env`. Le client n'envoie que trois entiers validés, il ne choisit jamais l'hôte appelé : pas de SSRF.
  - Pas de redirection suivie, réponse limitée à 1 Mo, types image uniquement.
  - Cache en mémoire (LRU, 24 h) ; attribution affichée sur la carte.
  - Avec OpenStreetMap, respecter la politique d'usage : User-Agent identifiant, usage modéré. Pour un usage soutenu, prendre un fournisseur commercial : sa clé va dans le gabarit, côté serveur.
- **« Ma position »** : la position reste dans le navigateur. Elle n'est envoyée que si l'utilisateur crée un point à cet endroit.
- Titres et descriptions sont insérés avec `textContent` : un titre « `<img onerror=...>` » s'affiche tel quel.

---

## 7. Messagerie

- **Flux classique** :
  - la page envoie le message en `POST` ;
  - le backend le valide et l'enregistre ;
  - le destinataire le récupère par **polling** : `GET /conversations/:id/messages?after=<dernier id>`, toutes les 3 s, la liste toutes les 10 s, en pause quand l'onglet est caché.

  Aucune clé ni aucun service tiers côté navigateur. Il n'y a pas de WebSocket ici.
- **Conversations** : directes, entre 2 personnes, avec une seule conversation par couple (clé unique). La table `participants_conversation` permet d'ajouter des groupes plus tard.
- **Le texte reste du texte (anti-XSS)** :
  - le message est stocké tel quel en UTF-8 (emojis libres) et affiché **uniquement** avec `textContent`, sans rendu HTML ni Markdown ;
  - 2000 caractères au plus, comptés en caractères affichés (un emoji = 1) ;
  - on refuse les caractères de contrôle, sauf le retour à la ligne, ainsi que les caractères d'inversion du sens du texte (U+202A–202E, U+2066–2069), qui servent à maquiller un texte ;
  - ESLint interdit `innerHTML`, `outerHTML` et `insertAdjacentHTML` dans les pages.
- **Pièces jointes** (une par message, avec une légende facultative) :
  - **réception** : `multer`, en mémoire, 1 fichier et 1 champ au plus ; taille réglée par `MAIN_APP_UPLOAD_MAX_BYTES`, avec 12 Mo au maximum côté nginx ;
  - **vrai type** : lu dans la signature du fichier (`file-type`), jamais dans l'extension ou le `Content-Type` ;
  - **liste blanche** : images JPEG, PNG, WebP, GIF ; audio MP3, OGG/Opus, WebM, M4A. **SVG exclu**, **pas de vidéo** ;
  - **images ré-encodées** avec `sharp` : métadonnées EXIF supprimées (dont la position GPS), orientation appliquée, taille réduite à 2560 px au plus ;
  - **stockage** : nom de fichier aléatoire (UUID), sur le volume `main-app-uploads` monté **uniquement** dans le conteneur messaging, hors des fichiers statiques ;
  - **lecture** : par une route sous session qui vérifie que l'utilisateur participe à la conversation, avec les en-têtes `X-Content-Type-Options: nosniff` et `Content-Security-Policy: default-src 'none'; sandbox` ;
  - **nettoyage** : le job `cleanupOrphanUploads` supprime les fichiers sans pièce jointe en base (envoi interrompu).
- **Message vocal** : enregistré avec `MediaRecorder`, 2 minutes au plus.
- **Participation** : vérifiée à **chaque** requête. Pour un non-participant, la réponse est 404, sans confirmer que la conversation existe.

---

## 8. Appels vocaux

- **Audio uniquement**, de 1 à 1, entre utilisateurs connectés. Le son passe en **WebRTC pair-à-pair** : il ne transite jamais par le serveur et n'est jamais enregistré.
- **Signalisation** (sonnerie, décroché, offre et réponse SDP, candidats ICE, raccroché) par **WebSocket** (`ws`, `/api/calls/ws`). C'est la seule fonctionnalité en temps réel.
  - **À l'ouverture** :
    - l'en-tête `Origin` doit valoir exactement `MAIN_APP_PUBLIC_ORIGIN` ;
    - le cookie de session doit être valide.

    Sinon la réponse est 403 ou 401.
  - **Ensuite** :
    - chaque message JSON est validé avec zod ;
    - 32 Ko au plus par message ;
    - 60 messages en rafale, puis 20 par seconde ;
    - la session est revérifiée toutes les 5 minutes, et un ping toutes les 30 s détecte une connexion morte.
- **Règles** :
  - un seul appel en cours par utilisateur : sinon « occupé » ;
  - sonnerie de 30 s au plus, puis « manqué » ;
  - seul l'appelé répond ou refuse ;
  - seuls les deux onglets engagés dans l'appel peuvent signaler.
- **Appel entrant sur toute page** : chaque page connectée ouvre le WebSocket et affiche un bandeau « Répondre / Refuser » (`gateway/html/shared/js/incomingCallListener.js`). « Répondre » ouvre la page Appels. Pendant le changement de page, le serveur garde l'appel en sonnerie et le renvoie à la nouvelle connexion.
- **Journal** `journal_appels` :
  - statut `missed`, `answered`, `declined` ou `failed` ;
  - `end_reason` précise la cause : `busy`, `callee_offline`, `no_answer`, `hung_up`, `connection_lost`… ;
  - historique consultable sur la page Appels.
- **STUN/TURN** (`MAIN_APP_ICE_SERVERS`) :
  - par défaut, un STUN public et **pas de serveur TURN** ;
  - **limite connue** : certains réseaux (4G d'opérateurs, Wi-Fi d'entreprise, NAT symétrique) bloquent le pair-à-pair, et l'appel échoue alors (« Liaison audio impossible ») ;
  - il faudra un serveur TURN (par exemple coturn), ajouté dans `MAIN_APP_ICE_SERVERS`. Ses identifiants partent forcément au navigateur : utiliser alors des identifiants à durée limitée.

---

## 9. Sécurité

En-têtes posés par le gateway sur **toutes** les réponses (`snippets/security-headers.conf`, inclus dans chaque `location`) :

| Route | Content-Security-Policy | Permissions-Policy |
|---|---|---|
| toutes | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws://<hôte> wss://<hôte>; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` | tout bloqué |
| `/map/*` | + `worker-src 'self' blob:` (MapLibre) | + `geolocation=(self)` |
| `/messaging/*` | + `media-src 'self' blob:` | + `microphone=(self)` |
| `/calls/*` | + `media-src 'self' blob:` | + `microphone=(self)`, `autoplay=(self)` |

Les autres en-têtes, sur toutes les réponses :

| En-tête | Valeur |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-Frame-Options` | `DENY` |

`server_tokens off`, et `X-Powered-By` est retiré.

**Dérogations documentées** :
- `connect-src` inclut `ws://` et `wss://` du même hôte **sur toutes les pages**, et pas seulement sur `/calls/`. Chaque page connectée écoute les appels entrants, et tous les navigateurs n'appliquent pas `'self'` aux WebSockets.
- `geolocation=(self)` sur la carte : c'est le bouton « Ma position ».
- `autoplay=(self)` sur les appels : la voix de l'interlocuteur doit démarrer sans clic.

Aucun `unsafe-inline` : il n'y a ni script ni style écrit dans le HTML.

Les autres protections :
- **CSRF** :
  - cookie `SameSite=Lax` ;
  - nginx refuse toute requête d'écriture (POST, PUT, PATCH, DELETE) dont l'`Origin` ne correspond pas à l'hôte (403) ;
  - le WebSocket vérifie son `Origin` côté Node.
- **Rate limiting** nginx : connexion (10/min), inscription (5/min), écriture de messages (60/min), envois de fichiers (20/min), API en général (20/s).
- **Taille des corps** : 64 Ko par défaut ; `client_max_body_size` est élevé (12 Mo) **uniquement** sur la route des pièces jointes. Côté Node, `express.json` accepte 32 Ko au plus.
- **`/internal/`** est bloqué (404). Le gateway ne lit jamais le corps des requêtes.
- **Même origine uniquement** : aucun en-tête CORS n'est posé.
- **Entrées** : toutes validées avec zod. SQL toujours paramétré.
- **Secrets** : aucun dans le code, les images ni le frontend ; tout vient de `.env`.
- **Dépendances** : versions figées par `package-lock.json` ; `npm audit --omit=dev` ne trouve aucune vulnérabilité.

---

## 10. Tests

```bash
# Unitaires + intégration contre une base PostgreSQL JETABLE (pgvector:pg16, migrations 0001 à 0018).
# La base du chatbot n'est jamais touchée.
sh main-app/tests/integration/runIntegrationTestsWithDisposableDatabase.sh
```

Jest + Supertest (et un vrai client `ws`) couvrent :

| Sujet | Fichier de test |
|---|---|
| Connexion, sessions, rôles, verrouillage, désactivation, administration | `integration/auth` |
| Droits sur les points, validation, bbox et proximité | `integration/map` |
| Relais des tuiles (pas de SSRF, cache) | `unit/map` |
| Appartenance aux conversations, texte brut, curseur, pièces jointes (vrai type, SVG refusé, EXIF supprimé, taille) | `integration/messaging` |
| Règles des appels | `unit/calls/callSignalingCoordinator` |
| Authentification du WebSocket : Origin, cookie, taille, débit | `unit/calls/callSignalingWebSocket` |
| Isolation des fonctionnalités | `unit/architecture` |

---

## 11. Limites connues

- **Appels** :
  - pas de serveur TURN (voir §8) ;
  - l'état des appels est en mémoire : redémarrer `main-app-calls` coupe les appels en cours ;
  - un seul conteneur `calls` est possible.
- **Messages vocaux** : les conteneurs WebM et MP4 servent aussi à la vidéo. Ils sont acceptés comme **audio** (c'est ce que produit `MediaRecorder`), servis en `audio/...` et lus par un lecteur audio, qui n'affiche aucune image. Les métadonnées des fichiers audio ne sont pas nettoyées (seules les images sont ré-encodées).
- **Polling** : un message arrive en 3 s au plus. Il n'y a pas de notification quand l'onglet est fermé.
- **Cache des tuiles** : en mémoire, perdu au redémarrage de `main-app-map`.
- **Port 5432** : la base du chatbot publie déjà ce port (`compose.backend.yaml`, inchangé). L'accès direct à la base depuis l'hôte n'est donc pas bloqué par la main app. Les conteneurs de la main app, eux, ne publient aucun port, sauf le gateway.
- **`docker compose up <service>`** relance aussi `init-db`, qui rejoue le seed du chatbot (idempotent). Pour l'éviter, utiliser `--no-deps`.
- **HTTPS** : le gateway écoute en HTTP. En production, le placer derrière un reverse proxy TLS. HSTS n'a d'effet qu'en HTTPS, et le micro comme la géolocalisation l'exigent.
## Navigation latérale

Les administrateurs disposent de deux groupes de liens directs : Administration
(comptes, propositions, interventions, codes d'erreur, pannes fréquentes) et
Fonctionnalités. Les autres rôles ne voient que les fonctionnalités.
Le chatbot et la nouvelle conversation sont accessibles sans menu déroulant.
Le bouton de réduction conserve la même icône, animée par rotation ; le mode
réduit rapproche les boutons du bas avec `--sidebar-compact-footer-gap`
dans `gateway/html/shared/css/base.css`. Les liens restent accessibles par
défilement sur les petits écrans et portent un libellé accessible en mode réduit.
