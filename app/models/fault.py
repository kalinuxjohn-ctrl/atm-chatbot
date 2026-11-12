"""
Modèles ORM pour le référentiel des codes d'erreur affichés sur les
équipements. Domaine volontairement séparé du catalogue symptôme/action
(catalog.py) : recherche texte classique uniquement (error_code_service.py),
jamais de pipeline vectoriel ici.
"""

from sqlalchemy import Column, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class Fault(Base):
    """Une panne connue (ex: 'Surchauffe moteur'), réutilisable par plusieurs codes d'erreur."""

    __tablename__ = "panne"

    fault_id = Column(Integer, primary_key=True)
    code = Column(String)
    name = Column(String, nullable=False)


class ErrorCode(Base):
    """Un code affiché par un équipement (ex: 'E42'), rattaché à une panne."""

    __tablename__ = "code_erreur"

    error_code_id = Column(Integer, primary_key=True)
    catalog_number = Column(Integer, nullable=False, unique=True)
    # Pas de unique=True ici : l'unicité réelle (insensible à la casse) est
    # portée par l'index UPPER(code) de la migration 0007, qu'un simple
    # unique=True sur cette colonne ne reproduirait pas.
    code = Column(String, nullable=False)
    description = Column(String)
    fault_id = Column(Integer, ForeignKey("panne.fault_id"))
    # Réponse enregistrée du menu « Codes d'erreur connus » (migration 0011) :
    # le code n'y apparaît que si ces deux colonnes sont remplies.
    device_type = Column(Enum("gab", "tpe", name="device_type", create_type=False))
    reply = Column(String)
    documentation = Column(JSONB, nullable=False, default=dict)

    fault = relationship("Fault")