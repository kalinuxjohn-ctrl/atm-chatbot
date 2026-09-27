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
    serial_number = Column(String, nullable=False, unique=True)
    model_id = Column(Integer, ForeignKey("device_model.model_id"), nullable=False)
    version_id = Column(Integer, ForeignKey("device_model_version.version_id"))
    site_name = Column(String, nullable=False)
    address = Column(String)
    install_date = Column(Date)
    # values_callable garde les valeurs Python en minuscules exactement comme
    # dans le type ENUM Postgres (device_status), plutôt que le nom du membre.
    status = Column(
        Enum("active", "decommissioned", "under_repair", name="device_status"),
        nullable=False,
        default="active",
    )

    # Relation pratique : device.interventions renvoie toutes les interventions
    # liées à cette machine, sans écrire la jointure à la main à chaque fois.
    interventions = relationship("Intervention", back_populates="device")