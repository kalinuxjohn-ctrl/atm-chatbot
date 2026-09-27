"""Modèle ORM pour la table technician."""

from sqlalchemy import Column, Integer, String, Boolean

from app.core.database import Base


class Technician(Base):
    __tablename__ = "technician"

    technician_id = Column(Integer, primary_key=True)
    full_name = Column(String, nullable=False)
    employee_code = Column(String, nullable=False)
    email = Column(String)
    phone = Column(String)
    region = Column(String)
    active = Column(Boolean, nullable=False, default=True)