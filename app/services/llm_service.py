"""
Adaptateur pour le LLM (aujourd'hui Ollama en local).

Structuré en interface (LLMProvider) + implémentation (OllamaProvider),
pas en simple fonction qui appelle l'API directement -- pour que remplacer
Ollama plus tard (service tiers payant, même serveur, serveur séparé) se
fasse en ajoutant UNE classe dans ce fichier, sans toucher au reste de
l'app : summarize_solutions() et chat.py n'appellent jamais Ollama
directement, seulement generate_reply().
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import requests

from app.core.config import settings


class LLMUnavailableError(Exception):
    """Le LLM n'a pas pu répondre -- le message est déjà rédigé pour l'utilisateur final."""


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

        return response.json().get("response", "")


def get_llm_provider() -> LLMProvider:
    """
    Point d'extension unique : brancher un autre backend LLM plus tard se
    fait ici (lire settings, choisir/instancier la bonne classe), jamais en
    modifiant les appelants de generate_reply().
    """
    return OllamaProvider(base_url=settings.ollama_base_url, model=settings.ollama_model)


def generate_reply(prompt: str) -> str:
    """
    Demande une réponse au LLM configuré. Ne laisse jamais remonter
    d'exception à l'appelant : en cas de problème (réseau, timeout, modèle
    absent...), renvoie directement le message d'erreur clair à la place du
    texte généré, pour que le reste de l'app reste fonctionnel en dégradé.
    """
    try:
        return get_llm_provider().generate(prompt)
    except LLMUnavailableError as erreur:
        return str(erreur)


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