#!/usr/bin/env bash
# Prépare le paquet à transférer (lancé dans WSL par envoyer.ps1) :
#   images.tar          images Docker déjà construites (backend, init-db, PostgreSQL, frontend)
#   volume-<nom>.tar    données des volumes Docker du projet (la base PostgreSQL)
#   project.tar         le dossier du projet, .env compris
#   manifest.txt        empreinte SHA-256 de chaque fichier (vérifiée à l'arrivée)
#
# Usage : preparer-paquet.sh <dossier projet> <dossier paquet> <inclure le cache des modèles : 0|1>
set -euo pipefail

PROJECT_DIR="$1"
BUNDLE_DIR="$2"
INCLUDE_MODEL_CACHE="$3"
PROJECT_NAME="$(basename "$PROJECT_DIR")"

cd "$PROJECT_DIR"
COMPOSE_PROJECT="$(docker compose config | sed -n 's/^name: //p' | head -1)"

echo "==> Images Docker utilisées par le projet"
IMAGES="$(docker compose config --images; (cd frontend && docker compose config --images))"
for image in $IMAGES; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "Image absente : $image. Lancez d'abord « docker compose build » (et dans frontend/)." >&2
    exit 1
  fi
  echo "    $image"
done
# Un seul fichier pour toutes les images : les couches communes ne sont copiées qu'une fois.
# shellcheck disable=SC2086
docker save -o "$BUNDLE_DIR/images.tar" $IMAGES

echo "==> Volumes Docker (base de données)"
DB_CONTAINER="atm_db"
DB_WAS_RUNNING="$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || echo false)"
# Base arrêtée pendant la copie : sinon les fichiers copiés peuvent être incohérents.
if [ "$DB_WAS_RUNNING" = "true" ]; then docker compose stop db >/dev/null; fi
: > "$BUNDLE_DIR/volumes.txt"
for volume in $(docker volume ls -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT"); do
  label="$(docker volume inspect -f '{{index .Labels "com.docker.compose.volume"}}' "$volume")"
  echo "    $volume"
  docker run --rm -v "$volume:/data:ro" -v "$BUNDLE_DIR:/backup" pgvector/pgvector:pg16 \
    tar -C /data -cf "/backup/volume-$volume.tar" .
  echo "$volume $label" >> "$BUNDLE_DIR/volumes.txt"
done
if [ "$DB_WAS_RUNNING" = "true" ]; then docker compose start db >/dev/null; fi

echo "==> Projet ($PROJECT_NAME)"
EXCLUDES=(--exclude="__pycache__" --exclude="*.pyc")
if [ "$INCLUDE_MODEL_CACHE" != "1" ]; then
  # Modèles Hugging Face (plusieurs Go) : inutiles avec EMBEDDING_PROVIDER=voyage.
  EXCLUDES+=(--exclude="$PROJECT_NAME/docker-cache")
fi
tar -C "$(dirname "$PROJECT_DIR")" -cf "$BUNDLE_DIR/project.tar" "${EXCLUDES[@]}" "$PROJECT_NAME"

printf '%s %s\n' "$PROJECT_NAME" "$COMPOSE_PROJECT" > "$BUNDLE_DIR/project.txt"

echo "==> Empreintes SHA-256"
cd "$BUNDLE_DIR"
sha256sum images.tar project.tar volume-*.tar volumes.txt project.txt > manifest.txt 2>/dev/null \
  || sha256sum images.tar project.tar volumes.txt project.txt > manifest.txt
du -ch images.tar project.tar volume-*.tar 2>/dev/null | tail -1 | sed 's/total/  taille totale du paquet/'
