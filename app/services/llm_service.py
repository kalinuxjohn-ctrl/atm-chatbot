"""Small adapter around Ollama for local LLM calls."""

from __future__ import annotations

from typing import Any

import requests

from app.core.config import settings


def generate_reply(prompt: str, model: str | None = None, base_url: str | None = None) -> str:
    """Ask the local Ollama service; fall back to a plain answer if it is unavailable."""
    chosen_model = model or settings.ollama_model
    chosen_base_url = base_url or settings.ollama_base_url
    payload = {"model": chosen_model, "prompt": prompt, "stream": False}

    try:
        response = requests.post(f"{chosen_base_url}/api/generate", json=payload, timeout=30)
        response.raise_for_status()
        payload_dict = response.json()
        return payload_dict.get("response", "")
    except Exception:
        return "Je n'ai pas pu joindre le modele local. Verifiez qu'Ollama est bien demarre."


ask_llm = generate_reply
