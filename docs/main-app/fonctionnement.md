# Fonctionnement

1. [Traitement d'une requête](#1-traitement-dune-requête)
2. [Comptes et connexion](#2-comptes-et-connexion)
3. [Carte](#3-carte)
4. [Messagerie](#4-messagerie)
5. [Appels](#5-appels)
6. [Interface](#6-interface)
7. [Tâches ponctuelles](#7-tâches-ponctuelles)
8. [Liste des routes de l'API](#8-liste-des-routes-de-lapi)
9. [Erreurs](#9-erreurs)

---

## 1. Traitement d'une requête

Toutes les requêtes passent par la passerelle nginx, qui les envoie au conteneur du module concerné selon l'URL :

| URL | Conteneur |
|---|---|
| `/auth/…`, `/api/auth/…` | `main-app-auth` |
| `/map/…`, `/api/map/…` | `main-app-map` |
| `/messaging/…`, `/api/messaging/…` | `main-app-messaging` |
| `/calls/…`, `/api/calls/…` | `main-app-calls` |
| `/`, `/shared/…` | pages communes, servies par nginx |

Dans le conteneur, la requête traverse les couches dans cet ordre :

```
route  →  middleware (session, rôle)  →  contrôleur (validation zod)  →  service (règles)  →  modèle (SQL)
```

En cas d'erreur, le middleware `errorHandler` renvoie une réponse JSON de la forme `{ "error": { "code": "...", "message": "..." } }`.

---

## 2. Comptes et connexion

### Connexion

- L'utilisateur se connecte avec un **nom d'utilisateur** et un **mot de passe** (pas d'email).
- Le mot de passe est vérifié avec argon2id.
- En cas de succès, le serveur crée une **session** en base et renvoie un cookie contenant un jeton aléatoire. La base ne garde que l'empreinte de ce jeton.
- La session dure 12 heures par défaut (`MAIN_APP_SESSION_DURATION_HOURS`).
- Chaque conteneur vérifie lui-même la session en base : si `main-app-auth` est arrêté, les autres modules fonctionnent toujours.

### Protection contre les essais répétés

Après 5 échecs pour un même couple (nom saisi, adresse IP), les tentatives sont bloquées pendant 15 minutes. Le message d'erreur est le même que le compte existe ou non.

### Rôles

| Rôle | Peut faire |
|---|---|
| `technicien` | Utiliser la carte, la messagerie et les appels ; modifier ses propres points |
| `moderator` | Comme un technicien, et modifier ou supprimer **tous** les points |
| `admin` | Comme un modérateur, et gérer les comptes et l’ATM-Chatbot (page `/admin/`) |

### Gestion des comptes (administrateur)

- **Créer un compte** : rattaché à un technicien déjà connu du chatbot, ou avec un nouveau technicien.
- **Changer le rôle**, **désactiver** ou **réactiver** un compte.
- **Réinitialiser le mot de passe** : toutes les sessions du compte sont fermées.
- Un administrateur ne peut pas modifier son propre compte, et il reste toujours au moins un administrateur actif.

L'inscription libre (`/auth/register.html`) n'est possible que si `MAIN_APP_ALLOW_REGISTRATION=true`.

---

## 3. Carte

- La page affiche une carte (Leaflet + MapLibre) avec les points partagés par tous les techniciens.
- **Ajouter un point** : clic sur la carte (ou « Ma position »), puis titre, catégorie et description.
- **Filtrer** : par catégorie, avec des boutons au-dessus de la carte.
- **Points proches** : liste des points dans un rayon donné autour de la position de l'utilisateur (50 km au plus).
- **Droits** : chacun modifie ou supprime ses propres points ; modérateurs et administrateurs gèrent tous les points. Le serveur renvoie `canModify` pour chaque point et revérifie les droits à chaque modification.

Les fonds de carte passent par le serveur (`/api/map/tiles/{z}/{x}/{y}`), qui les demande au fournisseur configuré et les garde en cache 24 heures.

La recherche par distance utilise les extensions PostgreSQL `cube` et `earthdistance` (pas besoin de PostGIS).

---

## 4. Messagerie

- **Conversations** à deux. Une seule conversation existe par paire de techniciens.
- **Messages** : texte (2000 caractères au plus, emojis acceptés), photo ou message vocal (2 minutes au plus), avec une légende facultative.
- **Réception** : la page interroge le serveur toutes les 3 secondes pour la conversation ouverte (`?after=<dernier id reçu>`) et toutes les 10 secondes pour la liste des conversations. L'interrogation s'arrête quand l'onglet est caché.
- **Non-lus** : chaque participant a un `last_read_message_id`. Les messages plus récents envoyés par l'autre personne sont comptés comme non lus.
- **Pièces jointes** :
  - le type réel du fichier est vérifié (pas seulement son extension) ;
  - formats acceptés : JPEG, PNG, WebP, GIF pour les images ; MP3, OGG, WebM, M4A pour l'audio ;
  - les photos sont ré-encodées : les données EXIF (dont la position GPS) sont supprimées ;
  - les fichiers sont enregistrés sous un nom aléatoire, dans le volume `main-app-uploads`.
- **Sécurité** : un utilisateur ne peut lire que les conversations auxquelles il participe. Le texte est toujours affiché comme du texte, jamais comme du HTML.

---

## 5. Appels

- Appels **audio** entre deux utilisateurs connectés.
- Le serveur gère seulement la **mise en relation** (sonnerie, décroché, raccroché) via un WebSocket (`/api/calls/ws`). Le son passe directement d'un navigateur à l'autre en **WebRTC** : il n'est jamais enregistré.
- **Règles** :
  - un seul appel à la fois par utilisateur (sinon « occupé ») ;
  - sonnerie de 30 secondes au plus, puis « manqué » ;
  - seul l'appelé peut répondre ou refuser.
- **Appel entrant** : un bandeau « Répondre / Refuser » s'affiche sur toutes les pages de l'application.
- **Historique** : chaque appel terminé est enregistré dans `journal_appels` (manqué, décroché, refusé, échoué) et affiché sur la page Appels.
- **Contacts** : la page indique qui est en ligne (au moins un onglet de l'application ouvert).

### Messages du WebSocket

| Envoyé par le navigateur | Rôle |
|---|---|
| `call.start` | Appeler un technicien |
| `call.accept` / `call.decline` | Répondre / refuser |
| `call.hang-up` | Raccrocher |
| `call.offer` / `call.answer` / `call.ice-candidate` | Échange WebRTC, relayé tel quel à l'autre participant |

| Envoyé par le serveur | Rôle |
|---|---|
| `connection.ready` | Connexion acceptée |
| `call.ringing` | L'appelé est en train de sonner (côté appelant) |
| `call.incoming` | Appel entrant (côté appelé) |
| `call.accepted` | L'appelé a décroché |
| `call.taken-elsewhere` | L'appel a été pris dans un autre onglet |
| `call.ended` | Fin de l'appel, avec sa raison |
| `error` | Message refusé |

**Limite** : sans serveur TURN, certains réseaux (4G, Wi-Fi d'entreprise) empêchent la liaison audio directe.

---

## 6. Interface

- Pages en HTML, CSS et JavaScript natifs, sans framework ni CDN : tout est servi par l'application.
- **Navigation** : barre latérale sur ordinateur, icônes seules sur tablette, onglets en bas sur mobile.
- **Thème clair / sombre** : bouton dans la barre de navigation ; le choix est mémorisé dans le navigateur.
- **Page d'accueil** : nombre de messages non lus, de techniciens en ligne et de points sur la carte.
- Si un module est arrêté, ses pages affichent « Service momentanément indisponible ».

| Page | URL |
|---|---|
| Accueil | `/` |
| Connexion | `/auth/login.html` |
| Inscription | `/auth/register.html` |
| ATM-Chatbot (chatbot intégré) | `/atm-chatbot/` (le chatbot lui-même : `/atm-chatbot/app/`) |
| Administration (admin) | `/admin/` : `#comptes`, `#propositions`, `#interventions`, `#codes-erreur`, `#pannes-frequentes` |
| Carte | `/map/` |
| Messagerie | `/messaging/` |
| Appels | `/calls/` |

---

### Administration (`/admin/`)

Page unique du gateway (`gateway/html/admin/`), une rubrique par sujet ; la rubrique ouverte suit l'adresse (`/admin/#propositions`…). L'ancienne adresse `/auth/accounts.html` redirige vers `/admin/#comptes`.

| Rubrique | Source | Rôle |
|---|---|---|
| Comptes | `/api/auth/accounts` | Créer un compte, changer un rôle, désactiver, nouveau mot de passe |
| Propositions | `/api/atm-chatbot-admin/solution-proposals` | Approuver (rejoint le catalogue d'actions) ou rejeter une solution proposée depuis l’ATM-Chatbot |
| Ajouts d'intervention | `/api/atm-chatbot-admin/intervention_add` | Voir l'intervention racontée, l'aperçu de l'écriture, approuver ou rejeter |
| Codes d'erreur | `/api/atm-chatbot-admin/error_code` | Réponses enregistrées du menu « Codes d'erreur connus » |
| Pannes fréquentes | `/api/atm-chatbot-admin/usual_problem` | Réponses enregistrées du menu « Pannes fréquentes » |

Les décisions sont signées avec le nom de l'administrateur connecté. Le sommaire affiche le nombre de demandes en attente.

### Icônes

Jeu [Lucide](https://lucide.dev) (licence ISC, `gateway/html/shared/js/LICENSE-lucide.txt`). `shared/js/icons.js` est **généré** par `gateway/scripts/generate_lucide_icons.py` : pour ajouter une icône, l'ajouter dans la table du script puis le relancer (`python main-app/gateway/scripts/generate_lucide_icons.py`).

## 7. Tâches ponctuelles

Scripts de `src/jobs/`, lancés avec `node src/jobs/<nom>.js` dans un conteneur :

| Script | Rôle |
|---|---|
| `createAdmin.js` | Crée le premier administrateur (saisie interactive) |
| `cleanupExpiredSessions.js` | Supprime les sessions expirées |
| `cleanupOrphanUploads.js` | Supprime les fichiers envoyés sans message associé |
| `configureDatabaseRole.js` | Donne son mot de passe au rôle SQL `main_app_user` (lancé automatiquement au démarrage) |

---

## 8. Liste des routes de l'API

Toutes les routes renvoient du JSON. Sauf indication contraire, elles demandent une session.

### Comptes : `/api/auth`

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| POST | `/login` | public | Se connecter |
| GET | `/registration` | public | Savoir si l'inscription libre est ouverte |
| POST | `/register` | public | S'inscrire (si autorisé) |
| POST | `/logout` | connecté | Se déconnecter |
| GET | `/me` | connecté | Utilisateur courant |
| POST | `/me/password` | connecté | Changer son mot de passe |
| GET | `/accounts` | admin | Lister les comptes |
| POST | `/accounts` | admin | Créer un compte |
| PUT | `/accounts/:technicianId/role` | admin | Changer le rôle |
| PUT | `/accounts/:technicianId/active` | admin | Activer / désactiver |
| PUT | `/accounts/:technicianId/password` | admin | Réinitialiser le mot de passe |
| GET | `/internal/administrator-check` | gateway seulement | Contrôle `auth_request` avant l'administration de l’ATM-Chatbot (204 = admin). Bloquée depuis le navigateur (404) |
| GET | `/internal/session-check` | gateway seulement | Contrôle `auth_request` avant l’ATM-Chatbot (`/atm-chatbot/app/`) : 204 + en-tête `X-Authenticated-Technician-Id`. Bloquée depuis le navigateur (404) |

### Administration de l’ATM-Chatbot : `/api/atm-chatbot-admin` (gateway → API du chatbot)

Réservée aux administrateurs. Chaque requête est relayée vers `/api/admin/…` du chatbot avec la clé `ADMIN_API_KEY`. Les erreurs du chatbot gardent leur forme FastAPI (`{ "detail": … }`).

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/solution-proposals?status=` | Propositions par statut (`pending`, `approved`, `rejected`) |
| POST | `/solution-proposals/:id/approve` · `/reject` | Décider (`reviewed_by`, `admin_comment`, `canonical_text`) |
| GET | `/intervention_add?status=` | Ajouts d'intervention par statut |
| GET | `/intervention_add/:id/preview` | Ce que l'approbation écrira (rien n'est écrit) |
| POST | `/intervention_add/:id/approve` · `/reject` | Décider |
| GET · POST | `/error_code` | Lister / ajouter un code d'erreur |
| PUT · DELETE | `/error_code/:id` | Modifier / supprimer |
| GET · POST | `/usual_problem` | Lister / ajouter une panne fréquente |
| PUT · DELETE | `/usual_problem/:id` | Modifier / supprimer |

### Carte : `/api/map`

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/settings` | Réglages de la carte (zoom maximal, attribution) |
| GET | `/tiles/:z/:x/:y` | Fond de carte |
| GET | `/points?south&west&north&east` | Points de la zone affichée |
| GET | `/points/nearby?lat&lng&radius` | Points proches d'une position |
| POST | `/points` | Créer un point |
| GET | `/points/:pointId` | Lire un point |
| PATCH | `/points/:pointId` | Modifier un point (auteur, modérateur, admin) |
| DELETE | `/points/:pointId` | Supprimer un point (auteur, modérateur, admin) |

### Messagerie : `/api/messaging`

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/contacts` | Rechercher un technicien |
| GET | `/conversations` | Mes conversations, avec le nombre de non-lus |
| POST | `/conversations` | Ouvrir (ou retrouver) une conversation avec quelqu'un |
| GET | `/conversations/:conversationId/messages?after=` | Messages (après un identifiant) |
| POST | `/conversations/:conversationId/messages` | Envoyer un texte |
| POST | `/conversations/:conversationId/attachments` | Envoyer une photo ou un vocal (multipart) |
| POST | `/conversations/:conversationId/read` | Marquer comme lu |
| GET | `/attachments/:attachmentId` | Télécharger une pièce jointe |

### Appels : `/api/calls`

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/settings` | Serveurs STUN/TURN à utiliser |
| GET | `/contacts` | Techniciens et leur présence en ligne |
| GET | `/history` | Historique de mes appels |
| WebSocket | `/ws` | Signalisation des appels (voir §5) |

Chaque conteneur expose aussi `GET /health`, utilisé par Docker pour vérifier qu'il fonctionne (base de données comprise).

---

## 9. Erreurs

| Statut | `code` dans la réponse | Classe (`core/errors.js`) | Cas |
|---|---|---|---|
| 401 | `authentication_required` | `AuthenticationRequiredError` | Pas de session, ou session expirée |
| 403 | `access_denied` | `AccessDeniedError` | Rôle insuffisant, ou point appartenant à un autre |
| 404 | `reference_not_found` | `ReferenceNotFoundError` | Élément introuvable (ou conversation dont on n'est pas participant) |
| 409 | `state_conflict` | `StateConflictError` | Action impossible dans l'état actuel (ex. : retirer le dernier admin) |
| 413 | `payload_too_large` | `PayloadTooLargeError` | Fichier trop volumineux |
| 422 | `invalid_reference` | `InvalidReferenceError` | Données invalides (validation zod) |
| 429 | `too_many_attempts` | `TooManyAttemptsError` | Trop de tentatives de connexion |
| 503 | `external_service_unavailable` | `ExternalServiceUnavailableError` | Fournisseur de tuiles indisponible |

Si un conteneur est arrêté, la passerelle répond elle-même 503 (page « service indisponible », ou JSON pour `/api/`).
