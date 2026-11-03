# Gateway de la main app : nginx officiel, variante NON-ROOT (écoute sur 8080).
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY snippets/ /etc/nginx/snippets/
COPY html/ /usr/share/nginx/html/

# Réglages du Copilote (clé admin du chatbot, adresse publique du chatbot) :
# au démarrage, l'image remplace les ${VARIABLES} du modèle par celles de
# l'environnement et écrit le résultat dans /tmp (seul dossier inscriptible :
# le système de fichiers du conteneur est en lecture seule).
COPY templates/ /etc/nginx/templates/
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp

# Vérifie la configuration dès la construction de l'image : une erreur de
# syntaxe se voit au build, pas au démarrage en production.
RUN nginx -t -c /etc/nginx/nginx.conf

EXPOSE 8080
