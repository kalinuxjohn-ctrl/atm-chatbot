"""
Modèles ORM pour le catalogue normalisé : component, symptom, action, et la
table de statistiques dérivée symptom_action_outcome_stats.
"""

from sqlalchemy import Column, Integer, String, ForeignKey, Numeric, DateTime, Enum

from app.core.database import Base


class Component(Base):
    __tablename__ = "component"

    component_id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)


class Symptom(Base):
    __tablename__ = "symptom"

    symptom_id = Column(Integer, primary_key=True)
    canonical_text = Column(String, nullable=False)
    component_id = Column(Integer, ForeignKey("component.component_id"))


class Action(Base):
    __tablename__ = "action"

    action_id = Column(Integer, primary_key=True)
    canonical_text = Column(String, nullable=False)
    component_id = Column(Integer, ForeignKey("component.component_id"))


class SymptomActionOutcomeStats(Base):
    __tablename__ = "symptom_action_outcome_stats"

    # Clé composite : pas de colonne id séparée, le triplet (symptom_id,
    # action_id, device_type) EST l'identifiant de la ligne -- une même paire
    # symptôme/action a un score distinct sur GAB et sur TPE.
    symptom_id = Column(Integer, ForeignKey("symptom.symptom_id"), primary_key=True)
    action_id = Column(Integer, ForeignKey("action.action_id"), primary_key=True)
    device_type = Column(
        Enum("gab", "tpe", name="device_type"),
        primary_key=True,
    )
    attempts = Column(Integer, nullable=False)
    successes = Column(Integer, nullable=False)
    accuracy_score = Column(Numeric(5, 4), nullable=False)
    last_computed_at = Column(DateTime, nullable=False)