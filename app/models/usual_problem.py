"""
Modèle ORM des pannes fréquentes (migration 0011) : raccourcis du menu
« Pannes fréquentes » du Copilote, rédigés par les administrateurs, avec une
réponse enregistrée -- aucun lien avec le catalogue symptom ni avec la
recherche vectorielle.
"""

from sqlalchemy import Column, Enum, Integer, String

from app.core.database import Base


class UsualProblem(Base):
    __tablename__ = "usual_problem"

    usual_problem_id = Column(Integer, primary_key=True)
    device_type = Column(Enum("gab", "tpe", name="device_type", create_type=False), nullable=False)
    label = Column(String, nullable=False)
    reply = Column(String, nullable=False)
    display_order = Column(Integer, nullable=False, default=0)
