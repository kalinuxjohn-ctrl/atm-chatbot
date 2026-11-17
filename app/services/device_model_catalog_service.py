"""Gestion admin du catalogue des fabricants, modèles et versions d'équipement."""

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.errors import StateConflictError
from app.models.device import DeviceModel, DeviceModelVersion, Manufacturer
from app.schemas.catalog_schema import DeviceModelAdminCreate, DeviceModelAdminOut


def list_device_models(db: Session) -> list[DeviceModelAdminOut]:
    models = db.query(DeviceModel).order_by(func.lower(DeviceModel.model_name), DeviceModel.model_id).all()
    if not models:
        return []

    model_ids = [model.model_id for model in models]
    manufacturers = {
        manufacturer.manufacturer_id: manufacturer.name
        for manufacturer in db.query(Manufacturer).all()
    }
    versions = (
        db.query(DeviceModelVersion)
        .filter(DeviceModelVersion.model_id.in_(model_ids))
        .order_by(DeviceModelVersion.model_id, DeviceModelVersion.version_id)
        .all()
    )
    versions_by_model: dict[int, list[DeviceModelVersion]] = {}
    for version in versions:
        versions_by_model.setdefault(version.model_id, []).append(version)

    return [
        DeviceModelAdminOut(
            model_id=model.model_id,
            device_type=model.device_type,
            manufacturer_name=manufacturers.get(model.manufacturer_id),
            model_name=model.model_name,
            release_year=model.release_year,
            versions=versions_by_model.get(model.model_id, []),
        )
        for model in models
    ]


def create_device_model(db: Session, payload: DeviceModelAdminCreate) -> DeviceModelAdminOut:
    manufacturer_name = payload.manufacturer_name.strip()
    model_name = payload.model_name.strip()
    try:
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text("LOCK TABLE fabricant, modele_appareil IN SHARE ROW EXCLUSIVE MODE"))

        manufacturer = next(
            (
                candidate
                for candidate in db.query(Manufacturer).all()
                if (candidate.name or "").strip().casefold() == manufacturer_name.casefold()
            ),
            None,
        )
        if manufacturer is None:
            manufacturer = Manufacturer(name=manufacturer_name)
            db.add(manufacturer)
            db.flush()

        existing = next(
            (
                candidate
                for candidate in db.query(DeviceModel).all()
                if (candidate.model_name or "").strip().casefold() == model_name.casefold()
                and candidate.device_type == payload.device_type
                and candidate.manufacturer_id == manufacturer.manufacturer_id
            ),
            None,
        )
        if existing is not None:
            raise StateConflictError("Ce modèle existe déjà pour ce fabricant et cet équipement.")

        model = DeviceModel(
            device_type=payload.device_type,
            manufacturer_id=manufacturer.manufacturer_id,
            model_name=model_name,
            release_year=payload.release_year,
        )
        db.add(model)
        db.flush()
        version = None
        if payload.version_label:
            version = DeviceModelVersion(
                model_id=model.model_id,
                version_label=payload.version_label.strip(),
                hardware_rev=(payload.hardware_rev or "").strip() or None,
                notes=(payload.notes or "").strip() or None,
            )
            db.add(version)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(model)
    if version is not None:
        db.refresh(version)
    return DeviceModelAdminOut(
        model_id=model.model_id,
        device_type=model.device_type,
        manufacturer_name=manufacturer.name,
        model_name=model.model_name,
        release_year=model.release_year,
        versions=[version] if version is not None else [],
    )
