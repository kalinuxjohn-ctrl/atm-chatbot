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

> Après une modification du frontend, relancez toujours avec `--build` : les fichiers sont copiés dans l’image, sans volume. Un simple `docker compose up` réutilise l’ancienne image. Le serveur envoie `Cache-Control: no-cache` : le navigateur revérifie donc HTML, CSS et JS à chaque chargement. Le Copilote refait se trouve sur <http://localhost:5173/copilot.html>, après connexion depuis l’accueil.

Le conteneur frontend relaie `/api/*` vers `http://host.docker.internal:8000`, c’est-à-dire le port hôte publié par le service `web` du Compose backend. Le navigateur appelle le frontend seulement ; l’adresse du backend reste côté serveur.

Correspondance des chemins dans le proxy (`server.py`) :

| Appel du navigateur | Route backend |
| --- | --- |
| `/api/chat`, `/api/chat/search-symptom` | identiques (le routeur FastAPI est déjà préfixé par `/api`) |
| `/api/error_code/...` | identique |
| `/api/health`, `/api/catalog/...`, `/api/interventions/...` | `/api` retiré : `/health`, `/catalog/...`, `/interventions/...` |

Le premier appel au LLM peut dépasser une minute (chargement du modèle) : le proxy attend jusqu’à 180 s (`PROXY_TIMEOUT_SECONDS`).

Pour reconstruire le frontend après une modification :

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
python server.py
```

Dans ce mode, il utilise par défaut `http://127.0.0.1:8000` comme adresse de l’API. Pour changer l’adresse, définissez `API_BASE_URL` avant de lancer le serveur.

## Pages

| Page | Rôle |
| --- | --- |
| `index.html` | Accueil animé (GAB + deux techniciens) et connexion. |
| `copilot.html` | Copilote : sidebar rétractable, chat écrit, dictée, Chat vocal immersif, panneau de contexte, paramètres. |
| `diagnostic.html` | Recherche directe dans l’historique des symptômes. |
| `flow-presentation.html` | Présentation animée du flux de connexion simulée et de traitement d’un message. |

## Structure

```text
public/
├── css/
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
    │   ├── suggestions.js            bulles de cas fréquents + animation vers la conversation
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

Aucune route vocale n’existe côté backend : tout passe par les API du navigateur (Chrome ou Edge recommandés), puis par `POST /api/chat`, comme le chat écrit.

- **Micro de la zone de saisie** : dicte le texte dans le champ, sans l’envoyer. États affichés : « Autorisation du micro… », « Écoute en cours… », « Traitement… », « Erreur microphone : … ».
- **Chat vocal** : voile translucide au-dessus de la conversation. Vous parlez, le texte est transcrit puis envoyé, et la réponse est lue à voix haute. C’est la **même** conversation : les échanges s’affichent aussi dans le chat. Option « mains libres » : le micro se rouvre après chaque réponse.
- **Voix** : seules les voix **françaises** installées sont proposées, groupées par région (« Français (France) », « Français (Canada) »…). Le choix (féminine / masculine ou voix précise) est enregistré et réellement utilisé. Si aucune voix française, ou aucune voix du genre choisi, n’est installée, les Paramètres l’indiquent. Sous Windows : Paramètres › Heure et langue › Voix › Ajouter des voix. Edge propose aussi des voix naturelles.
- **Erreur « réseau » de la reconnaissance vocale** : Chrome et Edge envoient l’audio à leur propre service de transcription. Si ce service est injoignable, par exemple dans le navigateur intégré de VS Code, Brave, Opera, un réseau filtré ou un VPN, le navigateur renvoie l’erreur `network` même si Internet fonctionne. Le Copilote l’explique, propose la reconnaissance hors ligne lorsque Chrome la prend en charge, ainsi qu’une saisie au clavier ou la dictée Windows (⊞ + H).

## Diagnostic

Le diagnostic appelle uniquement `POST /chat/search-symptom` avec `raw_text` et `device_type` (`gab` ou `tpe`). Les cartes utilisent les textes et statistiques effectivement fournis par l’API. Si un libellé d’action manque, l’interface affiche l’identifiant disponible et indique que le texte n’a pas été fourni ; elle n’invente pas de solution.
