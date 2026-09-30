"""Modèles ORM pour manufacturer, atm_model, atm_model_version et atm."""

from sqlalchemy import Column, Integer, String, Date, ForeignKey, Enum
from sqlalchemy.orm import relationship

from app.core.database import Base


class Manufacturer(Base):
    __tablename__ = "manufacturer"

    manufacturer_id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, unique=True)


class DeviceModel(Base):
    __tablename__ = "device_model"

    model_id = Column(Integer, primary_key=True)
    manufacturer_id = Column(Integer, ForeignKey("manufacturer.manufacturer_id"), nullable=False)
    model_name = Column(String, nullable=False)
    category = Column(String)
    release_year = Column(Integer)


class DeviceModelVersion(Base):
    __tablename__ = "device_model_version"

    version_id = Column(Integer, primary_key=True)
    model_id = Column(Integer, ForeignKey("device_model.model_id"), nullable=False)
    version_label = Column(String, nullable=False)
    hardware_rev = Column(String)
    notes = Column(String)


class Device(Base):
    __tablename__ = "device"

    device_id = Column(Integer, primary_key=True)
    # gab ou tpe -- seule colonne "externe" restée NOT NULL en base (migration 0001).
    device_type = Column(
        Enum("gab", "tpe", name="device_type"),
        nullable=False,
    )
    # Pas UNIQUE/NOT NULL en base : saisie terrain, doublons/erreurs possibles
    # (voir commentaire migration 0001).
    serial_number = Column(String)
    # Nullable en base : le modèle n'est pas toujours identifié sur place.
    model_id = Column(Integer, ForeignKey("device_model.model_id"))
    # Nullable en base, pas de NOT NULL dans la migration.
    site_name = Column(String)
    address = Column(String)
    install_date = Column(Date)
    status = Column(
        Enum("active", "decommissioned", "under_repair", name="device_status"),
        nullable=False,
        default="active",
    )

    interventions = relationship("Intervention", back_populates="device")