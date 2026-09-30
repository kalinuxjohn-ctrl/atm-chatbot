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

Le conteneur frontend relaie `/api/*` vers `http://host.docker.internal:8000`, c’est-à-dire le port hôte publié par le service `web` du Compose backend. Le navigateur appelle le frontend seulement ; l’adresse du backend reste côté serveur.

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

## Structure

- `server.py` sert `public/` et relaie les requêtes vers FastAPI.
- `public/index.html` est la page d’accueil, avec une illustration SVG/CSS sans image externe.
- `public/diagnostic.html` contient l’interface conversationnelle.
- `public/js/api.js` est l’unique couche HTTP et transforme la réponse réelle de l’API.
- `public/js/chat.js` gère les interactions, la saisie clavier et l’état de la requête.
- `public/js/ui.js` affiche les messages, symptômes, actions, erreurs et états sans résultat.
- `public/css/` sépare les styles de base, composants et règles responsive.

Le diagnostic appelle uniquement `POST /chat/search-symptom` avec `raw_text` et `device_type` (`gab` ou `tpe`). Les cartes utilisent les textes et statistiques effectivement fournis par l’API. Si un libellé d’action manque, l’interface affiche l’identifiant disponible et indique que le texte n’a pas été fourni ; elle n’invente pas de solution.
