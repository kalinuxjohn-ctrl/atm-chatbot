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
    database_url: str = "postgresql+psycopg2://postgres:postgrespassword@localhost:5432/atm_chatbot"

    # --- Moteur de vecteurs (auto-hébergé, remplace Voyage AI) ---
    embedding_model_name: str = "OrdalieTech/Solon-embeddings-base-0.1"
    embedding_dimensions: int = 1024

    # --- LLM local (Ollama) ---
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1"

    # --- Paramètres de la recherche (retrieval) ---
    retrieval_top_k: int = 5
    max_cases_returned: int = 3 

    llm_provider: str = "ollama"  # "ollama" | "gemini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"

    # --- Rattachement automatique au catalogue de symptômes ---
    # Distance cosinus maximale (pgvector `<=>`, 0 = identique, 2 = opposé)
    # en dessous de laquelle un nouveau symptôme est considéré comme "le
    # même" qu'un symptôme déjà catalogué et se voit assigner son symptom_id
    # automatiquement. Volontairement conservateur (0.15 ~ similarité
    # cosinus >= 0.85) : mieux vaut laisser un symptôme non catalogué que
    # le rattacher à tort à la mauvaise entrée du catalogue.
    symptom_catalog_match_max_distance: float = 0.15
    symptom_similarity_threshold: float = 0.5

    embedding_provider: str = "voyage"  
    voyage_api_key: str = ""
    voyage_model: str = "voyage-3-large"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()