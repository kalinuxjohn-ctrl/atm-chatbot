"""
Modèles ORM pour intervention (la table centrale) et tout ce qui s'y
accroche : intervention_symptom, intervention_action, diagnosis.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Boolean
from sqlalchemy.orm import relationship

from app.core.database import Base


class Intervention(Base):
    __tablename__ = "intervention"

    intervention_id = Column(Integer, primary_key=True)
    device_id = Column(Integer, ForeignKey("device.device_id"), nullable=False)
    technician_id = Column(Integer, ForeignKey("technician.technician_id"), nullable=False)
    ticket_reference = Column(String)
    opened_at = Column(DateTime, nullable=False)
    closed_at = Column(DateTime)
    final_outcome_status = Column(
        Enum("resolved", "partially_resolved", "unresolved", "escalated", name="intervention_outcome")
    )
    summary_text = Column(String)

    device = relationship("Device", back_populates="interventions")
    # cascade="all, delete-orphan" : si une intervention est supprimée, ses
    # lignes de symptômes/actions le sont aussi -- elles n'ont aucun sens
    # sans l'intervention parente.
    symptoms = relationship("InterventionSymptom", back_populates="intervention", cascade="all, delete-orphan")
    actions = relationship("InterventionAction", back_populates="intervention", cascade="all, delete-orphan")


class InterventionSymptom(Base):
    __tablename__ = "intervention_symptom"

    intervention_symptom_id = Column(Integer, primary_key=True)
    intervention_id = Column(Integer, ForeignKey("intervention.intervention_id"), nullable=False)
    symptom_id = Column(Integer, ForeignKey("symptom.symptom_id"))  # NULL si pas encore rattaché au catalogue
    raw_text = Column(String, nullable=False)  # formulation exacte du technicien
    severity = Column(String)
    # Remarque : la colonne `embedding` (vector) existe déjà en base
    # (migration 0003) mais n'est pas mappée ici tant que le moteur de
    # vecteurs n'est pas choisi -- elle sera ajoutée avec embeddings_service.py.

    intervention = relationship("Intervention", back_populates="symptoms")


class InterventionAction(Base):
    __tablename__ = "intervention_action"

    intervention_action_id = Column(Integer, primary_key=True)
    intervention_id = Column(Integer, ForeignKey("intervention.intervention_id"), nullable=False)
    action_id = Column(Integer, ForeignKey("action.action_id"))
    raw_text = Column(String, nullable=False)
    sequence_order = Column(Integer, nullable=False)
    performed_at = Column(DateTime)
    result_description = Column(String, nullable=False)
    outcome_status = Column(
        Enum("resolved", "partial", "no_effect", "made_worse", "unknown", name="action_outcome"),
        nullable=False,
        default="unknown",
    )
    is_confirmed_solution = Column(Boolean, nullable=False, default=False)

    intervention = relationship("Intervention", back_populates="actions")
    # Quel symptôme précis cette action visait -- NULL = comptée pour tous
    # les symptômes de l'intervention (comportement historique, voir
    # migration 0005 et stats_service.recompute_stats).
    targets_symptom_id = Column(Integer, ForeignKey("intervention_symptom.intervention_symptom_id"))


class Diagnosis(Base):
    __tablename__ = "diagnosis"

    diagnosis_id = Column(Integer, primary_key=True)
    intervention_id = Column(Integer, ForeignKey("intervention.intervention_id"), nullable=False)
    description = Column(String, nullable=False)
    root_cause_component_id = Column(Integer, ForeignKey("component.component_id"))
    confirmed = Column(Boolean, nullable=False, default=False)