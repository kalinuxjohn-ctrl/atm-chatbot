"""
Configuration centralisée de l'application.

Toutes les valeurs sensibles (clés API, URL de base de données) sont lues
depuis les variables d'environnement (fichier .env en local) -- jamais
codées en dur dans le code source. pydantic-settings valide les types et
lève une erreur explicite au démarrage si une variable obligatoire manque,
plutôt que de planter plus tard avec une erreur confuse.
"""

from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Base de données ---
    # Une valeur de secours rend le projet importable sans .env pendant le
    # développement local. Les valeurs explicites de l'environnement restent
    # prioritaires si elles sont présentes.
    database_url: str = "postgresql+psycopg2://postgres:postgrespassword@localhost:5432/atm_chatbot"

    # --- Moteur de vecteurs (auto-hébergé, remplace Voyage AI) ---
    # Solon-embeddings-large-0.1 (OrdalieTech) : les techniciens écrivent en
    # français, un modèle spécialisé français est plus précis ici qu'un
    # modèle multilingue générique -- voir le commentaire en tête de
    # app/services/embeddings_service.py pour le raisonnement complet.
    # Modifiable via la variable d'environnement EMBEDDING_MODEL_NAME sans
    # toucher au code, par exemple pour repasser sur un modèle plus léger en
    # production si la machine cible est moins puissante que celle de dev.
    embedding_model_name: Optional[str] = "OrdalieTech/Solon-embeddings-large-0.1"
    # 1024 = dimension native de ce modèle, doit rester synchronisée avec
    # `vector(1024)` dans db/migrations/0003_pgvector.sql.
    embedding_dimensions: Optional[int] = 1024

    # --- LLM local (Ollama) ---
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1"

    # --- Paramètres de la recherche (retrieval) ---
    retrieval_top_k: int = 5
    max_cases_returned: int = 3

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()