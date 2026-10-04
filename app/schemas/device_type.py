"""
Type partagé pour device_type : seules valeurs autorisées "gab" et "tpe",
alignées sur l'ENUM PostgreSQL `device_type` (migration 0001).
"""

from typing import Annotated, Literal

from pydantic import BeforeValidator, StringConstraints

def normalize_device_type(value):
    # " GAB " -> "gab" ; toute autre valeur est ensuite rejetée par le Literal.
    if isinstance(value, str):
        return value.strip().lower()
    return value


DeviceType = Annotated[Literal["gab", "tpe"], BeforeValidator(normalize_device_type)]

# Texte libre obligatoire : espaces retirés, chaîne vide refusée (422) -- un
# texte vide donnerait un embedding nul, inexploitable par la recherche.
NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
