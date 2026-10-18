#!/usr/bin/env bash
# Installe le projet reçu (lancé dans la WSL du PC qui reçoit, par recevoir.ps1) :
# télécharge le paquet depuis le PC qui envoie, vérifie les empreintes, charge
# les images Docker, restaure la base, puis démarre le projet. Aucun accès à
# Internet n'est nécessaire : tout vient du réseau local.
#
# Usage : recevoir.sh <ip:port du PC qui envoie> <jeton>
set -euo pipefail

BASE_URL="http://$1"
TOKEN="$2"
WORK_DIR="$HOME/.atm-share"

fetch() { curl -fSL --progress-bar "$BASE_URL/fichiers/$1?t=$TOKEN" -o "$WORK_DIR/$1"; }

echo "==> Vérification de Docker"
if ! docker info >/dev/null 2>&1; then
  echo "Docker ne répond pas dans WSL. Démarrez-le (sudo service docker start) et vérifiez que" >&2
  echo "votre utilisateur est dans le groupe docker (sudo usermod -aG docker \$USER, puis rouvrez WSL)." >&2
  exit 1
fi
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 est requis (docker compose)." >&2; exit 1; }

mkdir -p "$WORK_DIR"
echo "==> Téléchargement du paquet depuis $1"
fetch manifest.txt
for name in $(awk '{print $2}' "$WORK_DIR/manifest.txt"); do
  echo "    $name"
  fetch "$name"
done

echo "==> Vérification des empreintes SHA-256"
(cd "$WORK_DIR" && sha256sum -c --quiet manifest.txt)
read -r PROJECT_NAME COMPOSE_PROJECT < "$WORK_DIR/project.txt"
DEST="$HOME/$PROJECT_NAME"  # même nom de dossier : Compose retrouve ainsi les images et le volume

echo "==> Projet dans $DEST"
if [ -e "$DEST" ]; then
  BACKUP="$DEST.sauvegarde-$(date +%Y%m%d-%H%M%S)"
  echo "    un dossier $DEST existe déjà : déplacé dans $BACKUP"
  mv "$DEST" "$BACKUP"
fi
tar -xf "$WORK_DIR/project.tar" -C "$HOME"
mkdir -p "$DEST/docker-cache/huggingface"

echo "==> Chargement des images Docker"
docker load -i "$WORK_DIR/images.tar"

echo "==> Restauration de la base de données"
while read -r volume label; do
  [ -n "$volume" ] || continue
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "    le volume $volume existe déjà sur ce PC : conservé tel quel (rien n'est écrasé)"
    continue
  fi
  # Étiquettes Compose : le volume est reconnu comme celui du projet.
  docker volume create --label "com.docker.compose.project=$COMPOSE_PROJECT" \
    --label "com.docker.compose.volume=$label" "$volume" >/dev/null
  docker run --rm -v "$volume:/data" -v "$WORK_DIR:/backup:ro" pgvector/pgvector:pg16 \
    tar -C /data -xf "/backup/volume-$volume.tar"
  echo "    $volume restauré"
done < "$WORK_DIR/volumes.txt"

# `gpus: all` exige une carte NVIDIA prise en charge par Docker : sans elle, le
# conteneur web ne démarre pas. Le projet n'en a pas besoin avec Voyage.
if ! docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q nvidia; then
  sed -i 's/^\([[:space:]]*\)gpus: all/\1# gpus: all  # désactivé à l'\''installation : pas de GPU NVIDIA pour Docker sur ce PC/' "$DEST/docker-compose.yml"
  echo "==> Pas de GPU NVIDIA pour Docker : « gpus: all » désactivé dans docker-compose.yml"
fi

echo "==> Démarrage du projet"
(cd "$DEST" && docker compose up -d)
(cd "$DEST/frontend" && docker compose up -d)

rm -rf "$WORK_DIR"  # libère la place (~10 Go) : tout est maintenant dans Docker
curl -fsS "$BASE_URL/termine?t=$TOKEN" >/dev/null 2>&1 || true

echo
echo "Installation terminée."
echo "  Copilote : http://localhost:5173"
echo "  API      : http://localhost:8000/docs"
echo "  Projet   : $DEST  (dans WSL)"
