# Image Node COMMUNE aux 4 conteneurs applicatifs de la main app (auth, map,
# messaging, calls) : seule la commande change (docker-compose.main-app.yml).
# Le gateway nginx a sa propre image (gateway/Dockerfile).

# --- Étape 1 : dépendances de production, versions figées par package-lock.json ---
FROM node:22.23.4-bookworm-slim AS production-dependencies
WORKDIR /main-app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- Étape 2 : image finale, sans npm cache ni outils de build ---
FROM node:22.23.4-bookworm-slim
ENV MAIN_APP_ENVIRONMENT=production \
    NODE_ENV=production
WORKDIR /main-app

COPY --from=production-dependencies /main-app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY web ./web

# Dossier des pièces jointes : créé ici, au nom de l'utilisateur node, pour
# qu'un volume Docker neuf monté à cet endroit en hérite (sinon il
# appartiendrait à root et le conteneur, non-root, ne pourrait pas y écrire).
RUN mkdir -p /data/uploads && chown node:node /data/uploads && chmod 700 /data/uploads

# Jamais root : l'image officielle fournit l'utilisateur node (uid 1000).
USER node
EXPOSE 3000
