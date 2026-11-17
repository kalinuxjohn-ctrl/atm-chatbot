"""
Vérification locale et volontairement tolérante des messages, avant tout appel LLM.

On ne bloque que le bruit évident (message vide, que des symboles, touche
maintenue, motif répété, frappe au hasard sur le clavier). Tout le reste
passe : en cas de doute, c'est le LLM qui juge, pas ce filtre.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

REFORMULATION_REPLY = (
    "Votre message semble incomplet ou avoir été saisi accidentellement. "
    "Pouvez-vous reformuler votre problème ?"
)

# Un même motif répété au moins 4 fois ("aaaaaa", "111111", "test test test test").
# 4 et non 3 pour laisser passer un "non non non" légitime.
MIN_PATTERN_REPEATS = 4
MIN_REPEATED_LENGTH = 6

# Frappe au hasard ("asdfgh", "qsdfghjklm") : un seul mot, au moins 5 consonnes
# d'affilée. Aucun mot courant français/anglais n'en a autant.
MIN_SMASH_LENGTH = 6
MIN_CONSONANT_RUN = 5


@dataclass(frozen=True)
class TextValidationResult:
    valid: bool
    cleaned_text: str
    reason: str | None = None  # pourquoi le message est rejeté (pour les traces)


def clean_message(text: str) -> str:
    """Conserve accents, chiffres, ponctuation et retours à la ligne utiles."""
    normalized = unicodedata.normalize("NFKC", text).replace("\r\n", "\n").replace("\r", "\n")
    characters = []
    for character in normalized:
        category = unicodedata.category(character)
        if category in {"Cf", "Co", "Cs", "Cn"}:  # caractères invisibles ou non attribués
            continue
        characters.append(" " if category == "Cc" and character != "\n" else character)
    cleaned = re.sub(r"[^\S\n]+", " ", "".join(characters))
    return re.sub(r"\n+", "\n", re.sub(r" *\n *", "\n", cleaned)).strip()


def validate_and_clean_message(text: str) -> TextValidationResult:
    cleaned = clean_message(text)
    rejection_reason = _find_rejection_reason(cleaned)
    return TextValidationResult(valid=rejection_reason is None, cleaned_text=cleaned, reason=rejection_reason)


def _find_rejection_reason(text: str) -> str | None:
    if not text:
        return "empty_message"
    if not any(character.isalnum() for character in text):
        return "no_alphanumeric_content"
    if _is_repeated_pattern(text):
        return "repeated_pattern"
    if _is_keyboard_smash(text):
        return "keyboard_smash"
    return None


def _is_repeated_pattern(text: str) -> bool:
    compact = "".join(text.split()).casefold()
    if len(compact) < MIN_REPEATED_LENGTH:
        return False
    for unit_length in range(1, len(compact) // MIN_PATTERN_REPEATS + 1):
        unit = compact[:unit_length]
        if len(compact) % unit_length == 0 and unit * (len(compact) // unit_length) == compact:
            return True
    return False


def _is_keyboard_smash(text: str) -> bool:
    # Uniquement un mot isolé en lettres minuscules : un acronyme (SNMPTRAP),
    # un identifiant (lpszLogicalName) ou une phrase ne sont jamais concernés.
    if len(text) < MIN_SMASH_LENGTH or not text.isalpha() or not text.islower():
        return False
    consonant_run = longest_run = 0
    for character in text:
        is_consonant = character in "bcdfghjklmnpqrstvwxz"
        consonant_run = consonant_run + 1 if is_consonant else 0
        longest_run = max(longest_run, consonant_run)
    return longest_run >= MIN_CONSONANT_RUN
