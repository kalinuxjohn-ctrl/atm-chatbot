# Image Python légère : bibliothèque standard + edge-tts (voix françaises, /tts).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=5173 \
    API_BASE_URL=http://host.docker.internal:8000

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copie uniquement le serveur et les fichiers web dans l'image.
COPY server.py ./server.py
COPY public ./public

# L'écoute se fait sur 5173 dans le conteneur.
EXPOSE 5173

# Vérifie que le serveur web répond depuis le conteneur.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:5173/', timeout=2)"

CMD ["python", "server.py"]
