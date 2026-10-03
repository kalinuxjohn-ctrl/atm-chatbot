"""
Type partagé pour device_type : seules valeurs autorisées "gab" et "tpe",
alignées sur l'ENUM PostgreSQL `device_type` (migration 0001).
"""

from typing import Annotated, Literal

from pydantic import BeforeValidator

def normalize_device_type(value):
    # " GAB " -> "gab" ; toute autre valeur est ensuite rejetée par le Literal.
    if isinstance(value, str):
        return value.strip().lower()
    return value


DeviceType = Annotated[Literal["gab", "tpe"], BeforeValidator(normalize_device_type)]
