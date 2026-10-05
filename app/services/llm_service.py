"""
Adaptateur pour le LLM. Trois fournisseurs disponibles aujourd'hui :
Ollama (local), Gemini (API gratuite), Claude (API -- payante, c'est le
fournisseur prévu pour la version finale).

Structuré en interface (LLMProvider) + implémentations, pas en fonctions
qui appellent chaque API directement -- changer de fournisseur = changer
settings.llm_provider, sans toucher à summarize_solutions(),
chat_orchestrator_service.py ou message_understanding_service.py : ils
n'appellent jamais un fournisseur directement, seulement generate_reply().

Pas de repli implicite entre fournisseurs : settings.llm_provider choisit
UN fournisseur actif, et une valeur inconnue est une erreur de
configuration explicite, pas un retour silencieux vers Ollama.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import requests

from app.core.config import settings
from app.core.errors import ExternalServiceUnavailableError
from app.core.tracing import trace


class LLMUnavailableError(ExternalServiceUnavailableError):
    """
    Le LLM n'a pas répondu, ou pas de façon exploitable. Le message décrit la
    cause précise pour les journaux du serveur ; il n'est JAMAIS montré au
    technicien (app/main.py renvoie un 503 au message neutre).
    """


class LLMProvider(ABC):
    """Interface commune à tout backend LLM."""

    @abstractmethod
    def generate(self, prompt: str) -> str:
        """Renvoie le texte généré, ou lève LLMUnavailableError avec un message clair."""


class OllamaProvider(LLMProvider):
    """Appelle un serveur Ollama local via son API HTTP."""

    def __init__(self, base_url: str, model: str, timeout: int = 120):
        self.base_url = base_url
        self.model = model
        self.timeout = timeout

    def generate(self, prompt: str) -> str:
        try:
            response = requests.post(
                f"{self.base_url}/api/generate",
                json={"model": self.model, "prompt": prompt, "stream": False},
                timeout=self.timeout,
            )
        except requests.ConnectionError as erreur:
            raise LLMUnavailableError(
                f"Impossible de joindre Ollama à {self.base_url} -- vérifiez qu'il est "
                f"démarré et accessible depuis ce conteneur."
            ) from erreur
        except requests.Timeout as erreur:
            raise LLMUnavailableError(
                f"Ollama n'a pas répondu dans le délai imparti ({self.timeout}s)."
            ) from erreur
        except requests.RequestException as erreur:
            raise LLMUnavailableError(
                f"Erreur réseau lors de l'appel à Ollama ({type(erreur).__name__})."
            ) from erreur

        if response.status_code == 404:
            raise LLMUnavailableError(
                f"Le modèle '{self.model}' n'est pas installé sur Ollama "
                f"(essayez : ollama pull {self.model})."
            )
        try:
            response.raise_for_status()
        except requests.HTTPError as erreur:
            raise LLMUnavailableError(
                f"Ollama a répondu avec une erreur ({response.status_code})."
            ) from erreur

        try:
            return response.json()["response"]
        except (ValueError, KeyError, TypeError) as erreur:
            raise LLMUnavailableError("Ollama n'a renvoyé aucun texte exploitable pour cette requête.") from erreur


class GeminiProvider(LLMProvider):
    """Appelle l'API Gemini de Google (offre gratuite via Google AI Studio -- quotas limités)."""

    _ENDPOINT_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def __init__(self, api_key: str, model: str, timeout: int = 60):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def generate(self, prompt: str) -> str:
        if not self.api_key:
            raise LLMUnavailableError(
                "Aucune clé API Gemini configurée (GEMINI_API_KEY) -- impossible d'utiliser ce fournisseur."
            )

        try:
            response = requests.post(
                self._ENDPOINT_TEMPLATE.format(model=self.model),
                headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=self.timeout,
            )
        except requests.ConnectionError as erreur:
            raise LLMUnavailableError(
                "Impossible de joindre l'API Gemini -- vérifiez la connexion réseau du conteneur."
            ) from erreur
        except requests.Timeout as erreur:
            raise LLMUnavailableError(
                f"Gemini n'a pas répondu dans le délai imparti ({self.timeout}s)."
            ) from erreur
        except requests.RequestException as erreur:
            raise LLMUnavailableError(
                f"Erreur réseau lors de l'appel à Gemini ({type(erreur).__name__})."
            ) from erreur

        if response.status_code in (401, 403):
            raise LLMUnavailableError("Clé API Gemini invalide ou expirée.")
        if response.status_code == 429:
            raise LLMUnavailableError(
                "Quota gratuit Gemini dépassé pour l'instant (limite par minute/jour) -- réessayez plus tard."
            )
        if response.status_code == 404:
            raise LLMUnavailableError(f"Modèle Gemini '{self.model}' introuvable ou non accessible avec cette clé.")
        try:
            response.raise_for_status()
        except requests.HTTPError as erreur:
            raise LLMUnavailableError(f"Gemini a répondu avec une erreur ({response.status_code}).") from erreur

        try:
            return response.json()["candidates"][0]["content"]["parts"][0]["text"]
        except (ValueError, KeyError, IndexError, TypeError) as erreur:
            # Arrive par exemple si Gemini bloque la réponse (finishReason="SAFETY") --
            # pas une panne réseau, mais pas de texte exploitable non plus.
            raise LLMUnavailableError("Gemini n'a renvoyé aucun texte exploitable pour cette requête.") from erreur


class ClaudeProvider(LLMProvider):
    """
    Appelle l'API Claude d'Anthropic. C'est le fournisseur prévu pour la
    version finale du projet -- contrairement à Gemini, cette API est
    PAYANTE (pas de palier gratuit équivalent) : à activer en connaissance
    de cause, pas par défaut en développement.
    """

    _ENDPOINT = "https://api.anthropic.com/v1/messages"
    _API_VERSION = "2023-06-01"

    def __init__(self, api_key: str, model: str, max_tokens: int = 1024, timeout: int = 60):
        self.api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self.timeout = timeout

    def generate(self, prompt: str) -> str:
        if not self.api_key:
            raise LLMUnavailableError(
                "Aucune clé API Claude configurée (CLAUDE_API_KEY) -- impossible d'utiliser ce fournisseur."
            )

        try:
            response = requests.post(
                self._ENDPOINT,
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": self._API_VERSION,
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "max_tokens": self.max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=self.timeout,
            )
        except requests.ConnectionError as erreur:
            raise LLMUnavailableError(
                "Impossible de joindre l'API Claude -- vérifiez la connexion réseau du conteneur."
            ) from erreur
        except requests.Timeout as erreur:
            raise LLMUnavailableError(
                f"Claude n'a pas répondu dans le délai imparti ({self.timeout}s)."
            ) from erreur
        except requests.RequestException as erreur:
            raise LLMUnavailableError(
                f"Erreur réseau lors de l'appel à Claude ({type(erreur).__name__})."
            ) from erreur

        if response.status_code == 401:
            raise LLMUnavailableError("Clé API Claude invalide ou expirée.")
        if response.status_code == 429:
            raise LLMUnavailableError("Limite de requêtes Claude atteinte -- réessayez plus tard.")
        if response.status_code == 404:
            raise LLMUnavailableError(f"Modèle Claude '{self.model}' introuvable ou non accessible avec cette clé.")
        try:
            response.raise_for_status()
        except requests.HTTPError as erreur:
            raise LLMUnavailableError(f"Claude a répondu avec une erreur ({response.status_code}).") from erreur

        try:
            # Le premier bloc n'est pas forcément du texte : on prend le premier bloc "text".
            blocks = response.json()["content"]
            return next(block["text"] for block in blocks if block.get("type") == "text")
        except (ValueError, KeyError, IndexError, TypeError, StopIteration) as erreur:
            raise LLMUnavailableError("Claude n'a renvoyé aucun texte exploitable pour cette requête.") from erreur


_PROVIDERS = {
    "ollama": lambda: OllamaProvider(base_url=settings.ollama_base_url, model=settings.ollama_model),
    "gemini": lambda: GeminiProvider(api_key=settings.gemini_api_key, model=settings.gemini_model),
    "claude": lambda: ClaudeProvider(api_key=settings.claude_api_key, model=settings.claude_model),
}


def get_llm_provider() -> LLMProvider:
    """
    Point d'extension unique : brancher un nouveau backend LLM plus tard se
    fait en ajoutant une classe + une entrée dans _PROVIDERS, jamais en
    modifiant les appelants de generate_reply().

    Aucun repli implicite : un settings.llm_provider non reconnu est une
    erreur de configuration (faute de frappe, nouveau fournisseur pas
    encore branché...), pas un retour silencieux vers un autre fournisseur.
    """
    try:
        return _PROVIDERS[settings.llm_provider]()
    except KeyError:
        raise LLMUnavailableError(
            f"Fournisseur LLM inconnu : '{settings.llm_provider}'. "
            f"Valeurs valides : {', '.join(_PROVIDERS)}."
        )


def generate_reply(prompt: str, fallback: str | None = None) -> str:
    """
    Demande une réponse au LLM configuré.

    LLM indisponible (réseau, surcharge 503, quota, mauvaise config...) ou
    réponse vide :
    - SANS `fallback` : lève LLMUnavailableError. La requête HTTP se termine
      alors en 503 et le technicien voit « chatbot saturé » -- jamais le
      message technique, qui trahirait le fournisseur d'IA utilisé.
    - AVEC `fallback` : renvoie ce texte déjà prêt à la place. Réservé aux
      cas où l'appelant a des données factuelles à montrer même sans
      reformulation (ex. les cas trouvés dans l'historique).
    Dans les deux cas, la cause précise est écrite dans les journaux.
    """
    try:
        reply = get_llm_provider().generate(prompt)
        # Un LLM peut répondre "avec succès" mais sans aucun texte : traité
        # comme une panne, jamais renvoyé comme une bulle vide.
        if not isinstance(reply, str) or not reply.strip():
            raise LLMUnavailableError("Le LLM a répondu sans aucun texte.")
    except LLMUnavailableError as erreur:
        if fallback is None:
            raise
        trace("ERROR", "LLM indisponible, texte de secours utilisé", cause=str(erreur))
        return fallback
    return reply.strip()


ask_llm = generate_reply


def summarize_solutions(raw_text: str, solutions: list[dict]) -> str:
    """
    Résume en français les cas déjà connus retrouvés par la recherche
    (retrieval_service.find_ranked_solutions). Le prompt interdit
    explicitement d'inventer quoi que ce soit hors de cette liste -- le LLM
    reformule, il ne diagnostique jamais tout seul.
    """
    if not solutions:
        return "Aucune solution connue n'a été trouvée pour ce symptôme dans l'historique."

    lignes_cas = "\n".join(
        f"- Symptôme « {solution['symptom_text']} » : action « {solution['action_text']} » "
        f"réussie {solution['successes']}/{solution['attempts']} fois "
        f"(fiabilité {solution['accuracy_score']:.0%})"
        for solution in solutions
    )

    prompt = (
        "Tu es un assistant pour techniciens de maintenance. "
        f"Un technicien décrit ce symptôme : « {raw_text} ».\n"
        "Voici les cas déjà enregistrés dans l'historique, classés du plus au moins fiable :\n"
        f"{lignes_cas}\n\n"
        "Résume ces cas en 2-3 phrases claires, en français, pour aider le technicien à choisir "
        "quoi essayer en premier. N'invente AUCUNE information absente de la liste ci-dessus, et "
        "ne propose aucune action qui n'y figure pas."
    )

    return generate_reply(prompt)