#!/bin/sh
# ============================================================================
# Lance TOUS les tests (unitaires + intégration) contre une base PostgreSQL
# JETABLE : même image que le chatbot (pgvector/pgvector:pg16), mêmes
# migrations (db/migrations/0001 à 0018), puis tout est supprimé.
# La base du chatbot n'est jamais touchée.
#
#   sh main-app/tests/integration/runIntegrationTestsWithDisposableDatabase.sh
#
# Prérequis : Docker. Les node_modules sont gardés dans un volume Docker
# (main-app-test-node-modules) : rien n'est installé sur la machine hôte.
# ============================================================================
set -eu

repository_directory=$(cd "$(dirname "$0")/../../.." && pwd)
network_name=main-app-tests-network
database_container_name=main-app-tests-database
test_password=main-app-test-password-$(date +%s)

cleanup() {
  docker rm -f "$database_container_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker network create "$network_name" >/dev/null
docker run -d --name "$database_container_name" --network "$network_name" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=atm_chatbot \
  -v "$repository_directory/db/migrations:/migrations:ro" \
  pgvector/pgvector:pg16 >/dev/null

echo "Attente de la base de test..."
# L'image postgres démarre une première fois pour s'initialiser, s'arrête, puis
# redémarre pour de bon : on attend le message « prêt » de ce second démarrage.
until [ "$(docker logs "$database_container_name" 2>&1 | grep -c 'database system is ready to accept connections')" -ge 2 ]; do
  sleep 1
done

echo "Application des migrations du dépôt (comme init-db)..."
for migration_file in $(docker exec "$database_container_name" sh -c 'ls /migrations/*.sql | sort'); do
  docker exec "$database_container_name" psql -q -U postgres -d atm_chatbot -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null
done
# Ce que fait le job main-app-database-setup en vrai.
docker exec "$database_container_name" psql -q -U postgres -d atm_chatbot -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE main_app_user WITH LOGIN PASSWORD '$test_password';"

echo "Tests..."
docker run --rm --network "$network_name" \
  -v "$repository_directory/main-app:/main-app" \
  -v main-app-test-node-modules:/main-app/node_modules \
  -w /main-app \
  -e MAIN_APP_TEST_DATABASE_HOST="$database_container_name" \
  -e MAIN_APP_TEST_DATABASE_USER=main_app_user \
  -e MAIN_APP_TEST_DATABASE_PASSWORD="$test_password" \
  node:22-bookworm-slim \
  sh -c "if ! cmp -s package-lock.json node_modules/.installed-package-lock.json; then npm ci --no-audit --no-fund --loglevel=error --fetch-retries=5 --fetch-timeout=120000 && cp package-lock.json node_modules/.installed-package-lock.json; fi && npm run lint && npm test"
