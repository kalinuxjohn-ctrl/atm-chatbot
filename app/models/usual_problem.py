"""
Modèle ORM des pannes fréquentes (migration 0011) : raccourcis du menu
« Pannes fréquentes » de l’ATM-Chatbot, rédigés par les administrateurs, avec une
réponse enregistrée -- aucun lien avec le catalogue symptom ni avec la
recherche vectorielle.
"""

from sqlalchemy import JSON, Column, Enum, Integer, String
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base


class UsualProblem(Base):
    __tablename__ = "panne_frequente"

    usual_problem_id = Column(Integer, primary_key=True)
    device_type = Column(Enum("gab", "tpe", name="device_type", create_type=False), nullable=False)
    label = Column(String, nullable=False)
    reply = Column(String, nullable=False)
    display_order = Column(Integer, nullable=False, default=0)
    source_key = Column(String)
    documentation = Column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
