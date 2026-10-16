"""
Adaptateur pour le LLM. Deux fournisseurs disponibles aujourd'hui :
Gemini (API gratuite), Claude (API -- payante, c'est le
fournisseur prévu pour la version finale).

Structuré en interface (LLMProvider) + implémentations, pas en fonctions
qui appellent chaque API directement -- changer de fournisseur = changer
settings.llm_provider, sans toucher à summarize_solutions(),
chat_orchestrator_service.py ou message_understanding_service.py : ils
n'appellent jamais un fournisseur directement, seulement generate_reply().

Pas de repli implicite entre fournisseurs : settings.llm_provider choisit
UN fournisseur actif, et une valeur inconnue est une erreur de
configuration explicite, pas un retour silencieux vers un autre fournisseur.
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
    def generate_chat(self, system: str | None, messages: list[dict], cache_history: bool = False) -> str:
        """
        Renvoie le texte généré pour une conversation, ou lève LLMUnavailableError
        avec un message clair. `messages` : [{"role": "user" | "assistant",
        "content": str}, ...], en ordre chronologique, terminé par "user".

        `cache_history` : la consigne système et tous les messages sauf le
        dernier sont identiques d'un tour à l'autre ; un fournisseur qui sait
        les mettre en cache peut le faire (Claude). Les autres l'ignorent.
        """

    def generate(self, prompt: str) -> str:
        """Un seul message utilisateur, sans consigne système."""
        return self.generate_chat(None, [{"role": "user", "content": prompt}])


class GeminiProvider(LLMProvider):
    """Appelle l'API Gemini de Google (offre gratuite via Google AI Studio -- quotas limités)."""

    _ENDPOINT_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def __init__(self, api_key: str, model: str, timeout: int = 60):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def generate_chat(self, system: str | None, messages: list[dict], cache_history: bool = False) -> str:
        # cache_history ignoré : pas de cache explicite branché pour Gemini.
        if not self.api_key:
            raise LLMUnavailableError(
                "Aucune clé API Gemini configurée (GEMINI_API_KEY) -- impossible d'utiliser ce fournisseur."
            )

        # Gemini nomme "model" le rôle de l'assistant.
        payload = {
            "contents": [
                {"role": "model" if message["role"] == "assistant" else "user", "parts": [{"text": message["content"]}]}
                for message in messages
            ]
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}

        try:
            response = requests.post(
                self._ENDPOINT_TEMPLATE.format(model=self.model),
                headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=self.timeout,
            )
        except requests.Timeout as erreur:
            raise LLMUnavailableError(
                f"Gemini n'a pas répondu dans le délai imparti ({self.timeout}s)."
            ) from erreur
        except requests.ConnectionError as erreur:
            raise LLMUnavailableError(
                "Impossible de joindre l'API Gemini -- vérifiez la connexion réseau du conteneur."
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
            reply = response.json()["candidates"][0]["content"]["parts"][0]["text"]
            if not isinstance(reply, str) or not reply.strip():
                raise ValueError("Texte absent ou vide.")
            return reply
        except (ValueError, KeyError, IndexError, TypeError) as erreur:
            # Arrive par exemple si Gemini bloque la réponse (finishReason="SAFETY") --
            # pas une panne réseau, mais pas de texte exploitable non plus.
            raise LLMUnavailableError("Gemini n'a renvoyé aucun texte exploitable pour cette requête.") from erreur


class ClaudeProvider(LLMProvider):
    """
    Appelle l'API Claude d'Anthropic. C'est le fournisseur prévu pour la
    version finale du projet -- contrairement à Gemini, cette API est
    PAYANTE (pas de palier gratuit équivalent). Gemini reste sélectionnable
    explicitement en développement avec LLM_PROVIDER.
    """

    _ENDPOINT = "https://api.anthropic.com/v1/messages"
    _API_VERSION = "2023-06-01"
    # Cache d'1 heure : un technicien sur le terrain met souvent plus de 5
    # minutes (durée par défaut) entre deux messages.
    _CACHE_CONTROL = {"type": "ephemeral", "ttl": "1h"}

    def __init__(self, api_key: str, model: str, max_tokens: int = 2048, timeout: int = 60):
        self.api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self.timeout = timeout

    def generate_chat(self, system: str | None, messages: list[dict], cache_history: bool = False) -> str:
        if not self.api_key:
            raise LLMUnavailableError(
                "Aucune clé API Claude configurée (CLAUDE_API_KEY) -- impossible d'utiliser ce fournisseur."
            )

        payload = {"model": self.model, "max_tokens": self.max_tokens, "messages": messages}
        if system:
            payload["system"] = system
        if cache_history:
            payload.update(self._with_cache_markers(system, messages))

        try:
            response = requests.post(
                self._ENDPOINT,
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": self._API_VERSION,
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self.timeout,
            )
        except requests.Timeout as erreur:
            raise LLMUnavailableError(
                f"Claude n'a pas répondu dans le délai imparti ({self.timeout}s)."
            ) from erreur
        except requests.ConnectionError as erreur:
            raise LLMUnavailableError(
                "Impossible de joindre l'API Claude -- vérifiez la connexion réseau du conteneur."
            ) from erreur
        except requests.RequestException as erreur:
            raise LLMUnavailableError(
                f"Erreur réseau lors de l'appel à Claude ({type(erreur).__name__})."
            ) from erreur

        if response.status_code in (401, 403):
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
            if not isinstance(blocks, list) or not all(isinstance(block, dict) for block in blocks):
                raise ValueError("Blocs de contenu non conformes.")
            reply = next(block["text"] for block in blocks if block.get("type") == "text")
            if not isinstance(reply, str) or not reply.strip():
                raise ValueError("Texte absent ou vide.")
        except (ValueError, KeyError, IndexError, TypeError, StopIteration) as erreur:
            raise LLMUnavailableError("Claude n'a renvoyé aucun texte exploitable pour cette requête.") from erreur
        if cache_history:
            self._trace_cache_usage(response)
        return reply

    @classmethod
    def _with_cache_markers(cls, system: str | None, messages: list[dict]) -> dict:
        """
        Deux points de cache : la consigne système (fixe) et le dernier ancien
        message. Au tour suivant, tout ce début est identique : Claude le relit
        depuis le cache (facturé ~10 % du prix normal) au lieu de le retraiter.
        Le dernier message (contexte du tour + message du technicien) change à
        chaque fois : il reste après le dernier point de cache.
        """
        cached = {}
        if system:
            cached["system"] = [{"type": "text", "text": system, "cache_control": cls._CACHE_CONTROL}]
        if len(messages) >= 2:
            marked = [dict(message) for message in messages]
            last_history = marked[-2]
            last_history["content"] = [
                {"type": "text", "text": last_history["content"], "cache_control": cls._CACHE_CONTROL}
            ]
            cached["messages"] = marked
        return cached

    @staticmethod
    def _trace_cache_usage(response) -> None:
        """Nombres de jetons seulement : permet de vérifier que le cache sert vraiment."""
        try:
            usage = response.json().get("usage") or {}
        except (ValueError, AttributeError):
            return
        trace(
            "LLM",
            "Utilisation du cache Claude",
            cache_read_tokens=usage.get("cache_read_input_tokens", 0),
            cache_write_tokens=usage.get("cache_creation_input_tokens", 0),
            uncached_input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
        )


_PROVIDERS = {
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


def generate_reply(prompt: str) -> str:
    """
    Demande une réponse au LLM configuré.

    Toute panne ou réponse inexploitable lève LLMUnavailableError :
    aucun texte de secours ni changement implicite de fournisseur.
    """
    return _checked_reply(lambda provider: provider.generate(prompt))


def generate_chat_reply(system: str, messages: list[dict], cache_history: bool = False) -> str:
    """
    Comme generate_reply(), mais avec une consigne système et toute une
    conversation (voir LLMProvider.generate_chat, dont cache_history).
    """
    return _checked_reply(lambda provider: provider.generate_chat(system, messages, cache_history=cache_history))


def _checked_reply(call) -> str:
    try:
        reply = call(get_llm_provider())
        # Un LLM peut répondre "avec succès" mais sans aucun texte : traité
        # comme une panne, jamais renvoyé comme une bulle vide.
        if not isinstance(reply, str) or not reply.strip():
            raise LLMUnavailableError("Le LLM a répondu sans aucun texte.")
    except LLMUnavailableError as erreur:
        trace("ERROR", "Échec de l'appel au LLM", cause=str(erreur))
        raise
    return reply.strip()


ask_llm = generate_reply


def device_type_instruction(device_type: str | None) -> str:
    """
    Phrase à placer en tête d'un prompt pour que le LLM sache sur quel type
    d'appareil travaille le technicien. Le choix fait dans l'interface prime
    sur ce que le message mentionne (voir chat_orchestrator_service) : le
    LLM doit raisonner avec ce même type. Chaîne vide si le type est inconnu.
    """
    if not device_type:
        return ""
    label = device_type.upper()
    return (
        f"Le type d'appareil choisi dans l'interface est : {label}. "
        f"Privilégie ce type d'appareil : considère que le technicien travaille sur un {label}.\n"
    )


def summarize_solutions(problem_text: str, solutions: list[dict], device_type: str | None = None) -> str:
    """
    Distingue les résultats historiques des suggestions générales du chatbot,
    y compris lorsque la recherche ne renvoie aucune solution.
    """
    lignes_cas = "\n".join(
        f"- Symptôme « {solution['symptom_text']} » : action « {solution['action_text']} » "
        f"réussie {solution['successes']}/{solution['attempts']} fois "
        f"(fiabilité {solution['accuracy_score']:.0%})"
        for solution in solutions
    )

    prompt = (
        "Tu es un assistant pour techniciens de maintenance. "
        f"{device_type_instruction(device_type)}"
        f"Un technicien décrit ce symptôme : « {problem_text} ».\n"
        "Voici les cas déjà enregistrés dans l'historique, classés du plus au moins fiable :\n"
        f"{lignes_cas or 'Aucune solution historique trouvée.'}\n\n"
        "Résume ces cas en 2-3 phrases claires, en français, pour aider le technicien à choisir "
        "quoi essayer en premier. N'invente AUCUNE information historique absente de la liste ci-dessus, et "
        "ne présente pas une action extérieure à cette liste comme issue de la base. "
        "Vérifie la pertinence technique des résultats ; distingue les pistes indirectes des correspondances directes. "
        "Si la liste est vide ou non pertinente, dis : "
        "« Aucune solution correspondant à ce problème n'a été trouvée dans notre base de données. » "
        "Tu peux aussi proposer 2 à 4 vérifications adaptées, introduites simplement par : "
        "« Néanmoins, en tant que chatbot d'aide à la maintenance, je peux te conseiller ces vérifications : » "
        "si aucun résultat ne convient ; sinon utilise « En complément, voici mes conseils de chatbot : ». "
        "Cette introduction suffit à distinguer tes conseils des faits de la base : "
        "n'ajoute pas de long avertissement, de titre « hors base de données » ni de formule « Notez bien ». "
        "Ce sont des pistes, pas un diagnostic certain. "
        "Privilégie les contrôles non destructifs et les procédures constructeur ; "
        "n'invente ni code de maintenance ni contournement des sécurités. "
        "Demande les précisions manquantes si nécessaire. Utilise du Markdown simple : **gras**, titres et listes."
    )

    return generate_reply(prompt)