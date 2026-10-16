# ATM Assistant

Frontend vanilla HTML, CSS et JavaScript pour l’API FastAPI existante.

## Démarrage avec Docker

Depuis la racine du projet, démarrez d’abord le backend et sa base de données :

```powershell
docker compose up -d
```

Puis, dans le dossier `frontend`, construisez et démarrez le frontend :

```powershell
cd frontend
docker compose up --build -d
```

Ouvrez <http://localhost:5173>. Le backend reste accessible sur <http://localhost:8000>.

> Le dossier local `public` est monté dans le conteneur en lecture seule.
> Après une modification HTML, CSS, JavaScript ou d'image dans ce dossier,
> enregistrez puis rafraîchissez la page : aucun redémarrage ni rebuild n'est
> nécessaire. Le serveur envoie `Cache-Control: no-cache` : le navigateur
> revérifie les fichiers à chaque chargement. Cela ne recharge pas
> automatiquement une page déjà ouverte.
> Le Copilote se trouve sur <http://localhost:5173/copilot.html>, après connexion depuis l’accueil.

Le conteneur frontend relaie `/api/*` vers `http://host.docker.internal:8000`, c’est-à-dire le port hôte publié par le service `web` du Compose backend. Le navigateur appelle le frontend seulement ; l’adresse du backend reste côté serveur.

Correspondance des chemins dans le proxy (`server.py`) :

| Appel du navigateur | Route backend |
| --- | --- |
| `/api/chat`, `/api/chat/search-symptom` | identiques (le routeur FastAPI est déjà préfixé par `/api`) |
| `/api/error_code/...`, `/api/usual_problem/...` | identiques |
| `/api/health`, `/api/catalog/...`, `/api/interventions/...` | `/api` retiré : `/health`, `/catalog/...`, `/interventions/...` |

Le premier appel au LLM peut dépasser une minute (chargement du modèle) : le proxy attend jusqu’à 180 s (`PROXY_TIMEOUT_SECONDS`).

Si le conteneur existait avant l'ajout du volume, appliquez une seule fois
la nouvelle configuration depuis le dossier `frontend` :

```powershell
docker compose up -d --no-deps --force-recreate frontend
```

Les changements dans `public` seront ensuite visibles au rafraîchissement.
Les fichiers `server.py`, `requirements.txt` et `Dockerfile` restent copiés
dans l'image : après leur modification, reconstruisez le frontend :

```powershell
docker compose up --build -d
```

Pour consulter son état et ses journaux :

```powershell
docker compose ps
docker compose logs -f frontend
```

Pour arrêter le frontend sans toucher aux conteneurs du backend :

```powershell
docker compose down
```

## Démarrage local sans Docker

Vous pouvez aussi lancer le frontend directement avec Python :

```powershell
pip install -r requirements.txt   # voix françaises du Copilote (edge-tts), facultatif
python server.py
```

Dans ce mode, il utilise par défaut `http://127.0.0.1:8000` comme adresse de l’API. Pour changer l’adresse, définissez `API_BASE_URL` avant de lancer le serveur.

## Pages

Dans le Copilote, les commandes du menu et du contexte ont un contour accentué
et un état ouvert/fermé visible. Le bouton « Contexte » affiche son libellé sur
grand écran ; son libellé accessible et son info-bulle suivent l'état du panneau.
Le thème clair utilise des fonds blancs aux nuances de bleu, y compris le panneau
Contexte et l'animation de maintenance. Le thème sombre conserve sa palette verte.
Pendant l'attente d'une réponse, les trois points restent affichés et l'avatar SVG
anime une pose de réflexion (main au menton, tête inclinée et regard vers le haut).
Les avatars personnalisés sous forme d'image s'inclinent uniquement. En mode
mouvements réduits, la pose reste fixe.
Les paramètres proposent trois avatars : technicienne, technicien et robot.
Le robot utilise les mêmes animations de réflexion, parole et erreur et son
choix est mémorisé comme celui des avatars humains.
Lors d'une erreur, l'avatar baisse la tête, fronce les sourcils et fait un petit
mouvement de désaccord, puis revient au repos après une seule séquence de 2,8 s.
Les images personnalisées bougent sans modification du visage. Cette animation
est désactivée en mode mouvements réduits ; le message et « Réessayer » restent accessibles.
Les réponses du chatbot affichent un sous-ensemble Markdown : gras, italique,
titres, listes et code. Le texte utilisateur reste littéral ; le HTML et les
liens renvoyés par le modèle ne sont jamais exécutés ni rendus comme liens actifs.
Les entrées des suggestions sont des lignes de texte sans icône de conversation
répétée ; les codes d'erreur restent identifiables par leur code. Le panneau
Contexte présente les libellés et valeurs avec des séparateurs sobres et un fin
liseré coloré, sans bulles. Son bord blanc éclairé et son ombre asymétrique donnent
un effet de plaque de verre soulevée à gauche. De petits cercles décorent les choix des menus et
se remplissent sur l'entrée active, en suivant les couleurs du thème.

| Page | Rôle |
| --- | --- |
| `index.html` | Accueil animé (GAB, anneaux holographiques en perspective 3D et deux techniciens) et connexion. Les animations sont arrêtées si la préférence de réduction des mouvements est activée. |
| `copilot.html` | Copilote : engrenage animé avec clé de mécanicien et anneaux tournant en 3D autour du centre (bleus en mode clair, verts en mode sombre), à l'ouverture d'une conversation (sans animation en mode mouvements réduits), sidebar rétractable, chat écrit, dictée, Chat vocal immersif, panneau de contexte, paramètres. |
| `diagnostic.html` | Recherche directe dans l’historique des symptômes. |
| `flow-presentation.html` | Présentation animée du flux de connexion simulée et de traitement d’un message. |
| `admin.html` | Administration (clé `ADMIN_API_KEY`) : propositions des techniciens, codes d’erreur et pannes fréquentes du Copilote. |

## Structure

```text
public/
├── assets/               IMAGES modifiables (logo, fonds d'écran, avatars) -- mode d'emploi : assets/README.md
├── css/
│   ├── assets.css        chemins des images de fond : le SEUL endroit où les changer
│   ├── style.css         base commune (en-tête, chat, boutons)
│   ├── components.css    avatars, boîtes de dialogue, champs
│   ├── home.css          animations de l’accueil
│   ├── copilot.css       page Copilote complète (palette bleue, sidebar, chat, Chat vocal, paramètres, responsive)
│   └── responsive.css    petits écrans des pages Accueil / Diagnostic + prefers-reduced-motion
└── js/
    ├── config.js                     constantes (URL API, langue, mode démo)
    ├── core/httpClient.js            SEUL endroit qui appelle fetch
    ├── services/
    │   ├── api/                      un fichier par domaine (chat, voix, auth, historique…)
    │   │   └── mocks.js              réponses simulées
    │   ├── speech/                   reconnaissance vocale, synthèse vocale, niveau du micro
    │   ├── conversationService.js    fil de conversation partagé texte + voix
    │   ├── preferencesService.js     paramètres (localStorage)
    │   └── sessionService.js         technicien connecté
    ├── components/
    │   ├── avatar.js                 avatars humains du Copilote (SVG)
    │   ├── icons.js                  icônes SVG (data-icon="…")
    │   ├── sidebar.js                menu rétractable (large / icônes / tiroir mobile)
    │   ├── contextPanel.js           panneau "Contexte" (colonne ou tiroir)
    │   ├── chatView.js               affichage des messages
    │   ├── devicePicker.js           sélecteur GAB / TPE
    │   ├── suggestions.js            menus « Pannes fréquentes » et « Codes d'erreur connus » (données et réponses lues par le backend, sans IA)
    │   ├── composerDictation.js      micro de la zone de saisie (dictée)
    │   ├── voiceMode.js              Chat vocal immersif
    │   ├── settingsPanel.js          paramètres (avatar, voix française, options)
    │   └── diagnosticView.js
    ├── pages/                        un point d’entrée par page HTML
    └── utils/dom.js
```

Règle : les **pages** assemblent, les **components** affichent, les **services** contiennent la logique, et seuls les fichiers `services/api/` parlent au backend.

## API utilisées

| Fonction | Statut | Route |
| --- | --- | --- |
| Envoyer un message (chat + voix) | **Réelle** | `POST /api/chat` |
| Recherche de symptômes (Diagnostic) | **Réelle** | `POST /api/chat/search-symptom` |
| Connexion | Simulée | à venir : `POST /auth/login` |
| Historique d’une conversation | Simulé (sessionStorage) | à venir : `GET /chat/{id}/messages` |
| Réponse audio | Simulée (synthèse du navigateur) | à venir : route audio éventuelle |

Les points de branchement futurs sont marqués `TODO` dans `public/js/services/api/`.

`POST /api/chat` exige un `technician_id` existant en base (seed de démo : 7 ou 8).

## Mode démo

Ajoutez `?mock=1` à l’adresse pour utiliser des réponses simulées sans backend, et `?mock=0` pour revenir au backend réel. Le choix est conservé pour l’onglet en cours.

## Fonctions vocales

Le backend ne reçoit que du texte (`POST /api/chat`, comme le chat écrit). La reconnaissance vocale se fait dans le navigateur (Chrome ou Edge recommandés) ; la **voix du Copilote** est générée par le serveur frontend (`server.py`, routes `GET /tts/voices` et `POST /tts`, paquet `edge-tts`, connexion Internet requise).

- **Micro de la zone de saisie** : dicte le texte dans le champ, sans l’envoyer. États affichés : « Autorisation du micro… », « Écoute en cours… », « Traitement… », « Erreur microphone : … ».
- **Chat vocal** : écran plein, comme un appel ; la messagerie est masquée. Conversation entièrement à la voix : on parle naturellement, le message part tout seul après ~1,3 s de silence, la réponse est lue, puis le micro se rouvre automatiquement. Toucher la bulle envoie tout de suite (pendant l’écoute) ou interrompt le Copilote (pendant la lecture). C’est la **même** conversation : les échanges apparaissent dans le chat à la fermeture.
- **Voix** : uniquement des voix **françaises**. Par défaut, voix naturelles du serveur (Denise / Henri, et d’autres voix fr-FR, fr-BE, fr-CA, fr-CH), identiques dans tous les navigateurs. Si le serveur de synthèse est injoignable, le Copilote se rabat automatiquement sur les voix françaises du navigateur (jamais une voix anglaise).
- **Erreur « réseau » de la reconnaissance vocale** : Chrome et Edge envoient l’audio à leur propre service de transcription. Si ce service est injoignable, par exemple dans le navigateur intégré de VS Code, Brave, Opera, un réseau filtré ou un VPN, le navigateur renvoie l’erreur `network` même si Internet fonctionne. Le Copilote l’explique, propose la reconnaissance hors ligne lorsque Chrome la prend en charge, ainsi qu’une saisie au clavier ou la dictée Windows (⊞ + H).

## Diagnostic

Le diagnostic appelle uniquement `POST /chat/search-symptom` avec `raw_text` et `device_type` (`gab` ou `tpe`). Les cartes utilisent les textes et statistiques effectivement fournis par l’API. Si un libellé d’action manque, l’interface affiche l’identifiant disponible et indique que le texte n’a pas été fourni ; elle n’invente pas de solution.
