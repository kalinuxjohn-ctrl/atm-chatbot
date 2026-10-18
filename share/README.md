# Partager le projet avec un autre PC (réseau local, sans Internet)

Le PC qui envoie prépare un paquet et le sert sur le réseau local. Le PC qui
reçoit tape **une seule ligne** dans PowerShell : tout est téléchargé, vérifié,
installé et démarré.

## Ce qui est transféré

| Fichier du paquet | Contenu |
|---|---|
| `images.tar` | images Docker déjà construites : `atm-chatbot-web`, `atm-chatbot-init-db`, `pgvector/pgvector:pg16`, `frontend-frontend` |
| `volume-atm-chatbot_pgdata.tar` | la base PostgreSQL actuelle (interventions, embeddings, conversations…) |
| `project.tar` | le dossier du projet, **`.env` et ses clés API compris** |
| `manifest.txt` | l'empreinte SHA-256 de chaque fichier, vérifiée à l'arrivée |

Non transférés : `docker-cache` (modèles Hugging Face, ~5 Go, inutiles avec
Voyage ; option `-IncludeModelCache`), les `__pycache__`, et ta distribution
WSL elle-même (historique, clés SSH, identifiants git restent sur ton PC).

Rien n'est reconstruit ni téléchargé sur Internet à l'installation : les images
sont chargées telles quelles. En revanche, **le Copilote a besoin d'Internet
pour fonctionner** (Claude et Voyage AI).

## Prérequis du PC qui reçoit

- WSL 2 avec une distribution (Ubuntu) ;
- Docker Engine et Docker Compose v2 installés **dans** cette distribution,
  et l'utilisateur dans le groupe `docker` (`docker info` marche sans `sudo`) ;
- environ 25 Go libres dans WSL ;
- être sur le même réseau local que le PC qui envoie.

## 1. Sur ton PC (celui qui envoie)

```powershell
powershell -ExecutionPolicy Bypass -File F:\shared_folder\atm-chatbot\share\envoyer.ps1
```

- La fenêtre demande les droits administrateur : ils servent à ouvrir le port
  8765 dans le pare-feu, **le temps du transfert seulement**.
- La préparation prend plusieurs minutes (~10 Go). La base est arrêtée
  quelques secondes pendant sa copie, puis redémarrée.
- Le script affiche la ligne à donner à l'autre personne, par exemple :
  `irm "http://192.168.1.145:8765/recevoir.ps1?t=8bad…" | iex`

Options : `-Port 9000`, `-IncludeModelCache`, `-BundleParent D:\` (où créer le
dossier du paquet), `-KeepBundle` puis `-ReuseBundle` (envoyer le même paquet à
un autre PC sans le refaire).

## 2. Sur le PC de l'autre personne

Ouvrir PowerShell (pas besoin d'être administrateur) et coller la ligne
affichée. À la fin :

- Copilote : http://localhost:5173
- API : http://localhost:8000/docs
- Projet : `~/atm-chatbot` dans WSL (`cd ~/atm-chatbot && docker compose ps`)

Si un dossier `~/atm-chatbot` existait déjà, il est renommé
`atm-chatbot.sauvegarde-<date>`. Si une base `atm-chatbot_pgdata` existait déjà,
elle est conservée telle quelle (rien n'est écrasé).

Sans GPU NVIDIA reconnu par Docker, la ligne `gpus: all` du
`docker-compose.yml` reçu est désactivée automatiquement (le projet n'en a pas
besoin avec Voyage).

## Sécurité

- Le transfert passe en HTTP **non chiffré** sur le réseau local : à faire
  sur un réseau de confiance (pas un Wi-Fi public).
- Un jeton aléatoire, différent à chaque lancement, est exigé pour chaque
  fichier. Seuls les fichiers du paquet peuvent être téléchargés.
- Le port est refermé et la règle du pare-feu supprimée à la fin
  (installation terminée, ou Ctrl+C).
- Le `.env` contient **tes** clés API : l'autre personne utilisera ton quota
  et ta facture Claude / Voyage. Remplace-les dans son `.env` si besoin.
