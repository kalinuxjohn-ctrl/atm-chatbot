"""
Configuration centralisée de l'application.

Toutes les valeurs sensibles (clés API, URL de base de données) sont lues
depuis les variables d'environnement (fichier .env en local) -- jamais
codées en dur dans le code source. pydantic-settings valide les types et
lève une erreur explicite au démarrage si une variable obligatoire manque,
plutôt que de planter plus tard avec une erreur confuse.
"""

from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "atm-chatbot"

    # --- Base de données ---
    database_url: str = "postgresql+psycopg2://postgres:postgrespassword@localhost:5432/atm_chatbot"

    # --- Vecteurs Voyage AI, stockés dans PostgreSQL/pgvector ---
    embedding_dimensions: int = 1024

    # --- Paramètres de la recherche (retrieval) ---
    retrieval_top_k: int = 5
    max_cases_returned: int = 3 

    llm_provider: str = "claude"  # "claude" | "gemini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    # Utilisés par ClaudeProvider (llm_service.py) quand llm_provider="claude".
    claude_api_key: str = ""
    claude_model: str = Field(default="claude-sonnet-5-5", pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    # Sonnet 5.5 : synthèses sans réflexion préalable ; compréhension JSON inchangée.
    claude_fast_chat: bool = True

    # --- Conversation avec le LLM (message_understanding_service) ---
    # Seuil de condensation des échanges anciens (aussi déclenchée à 12000
    # caractères anciens). Six derniers échanges intacts ; originaux conservés.
    chat_history_max_messages: int = 100

    # --- Rattachement automatique au catalogue de symptômes ---
    # Distance cosinus maximale (pgvector `<=>`, 0 = identique, 2 = opposé)
    # en dessous de laquelle un nouveau symptôme est considéré comme "le
    # même" qu'un symptôme déjà catalogué et se voit assigner son symptom_id
    # automatiquement. Volontairement conservateur (0.15 ~ similarité
    # cosinus >= 0.85) : mieux vaut laisser un symptôme non catalogué que
    # le rattacher à tort à la mauvaise entrée du catalogue.
    symptom_catalog_match_max_distance: float = 0.15
    symptom_similarity_threshold: float = 0.5
    # Symptômes d'un même message cherchés séparément (un embedding chacun) :
    # plafond contre une facture Voyage qui exploserait sur un long message.
    max_symptoms_per_message: int = 5

    # --- Photos envoyées dans le chat (photo_ocr_service.py) ---
    # Interrupteur UNIQUE de la fonctionnalité : False (PHOTO_OCR_ENABLED=false
    # dans le .env) -> le bouton photo disparaît du chat et le backend ignore
    # toute photo reçue. Ne fonctionne qu'avec llm_provider="claude".
    photo_ocr_enabled: bool = True
    # Taille maximale d'une photo, une fois décodée. Le frontend la réduit
    # avant envoi (quelques centaines de Ko) ; Claude refuse au-delà de 5 Mo.
    photo_max_bytes: int = 3_500_000

    embedding_provider: str = "voyage"
    voyage_api_key: str = ""
    voyage_model: str = "voyage-3-large"

    # --- Propositions de solution (solution_proposal_service) ---
    # Clé des routes /api/admin, envoyée dans l'en-tête X-Admin-Key. Vide =
    # administration désactivée (toutes les routes admin répondent 403).
    admin_api_key: str = ""
    error_code_documents_dir: str = "db/code_erreurs"
    # À l'approbation (proposition de solution ou rapport d'intervention), une
    # action du catalogue plus proche que cette distance cosinus (0 = identique)
    # est réutilisée au lieu de créer un doublon.
    action_catalog_match_max_distance: float = 0.15

    # --- Déploiement avec l'Espace techniciens (app/core/gateway_identity.py) ---
    # Secret partagé avec le gateway de l'Espace techniciens. Vide = chatbot seul :
    # le technician_id envoyé par le frontend est cru. Défini = seules les requêtes
    # relayées par le gateway (session vérifiée) sont acceptées, et le technicien
    # est celui de la session.
    atm_chatbot_gateway_shared_secret: str = ""

    # extra="ignore" : le .env est partagé avec docker-compose --
    # une variable que l'app ne connaît pas ne doit pas
    # empêcher le démarrage.
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()