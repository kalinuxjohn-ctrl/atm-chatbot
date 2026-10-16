"""
Ajout d'intervention : le technicien décrit une intervention complète
(symptômes, actions tentées, cause), un administrateur la vérifie, puis elle
rejoint l'historique où la recherche des autres techniciens la trouvera.

    technicien ── POST demande ──────> submit_intervention_add()    intervention_add (pending)
    admin      ── GET aperçu ────────> preview_intervention_add()   ce qui sera écrit, table par table
               ── PUT correction ────> update_intervention_add()    intervention_add.content
               ── approuver ─────────> approve_intervention_add()   intervention, intervention_symptom,
                                                                    intervention_action, diagnosis (+ catalogue, stats)
               ── rejeter ───────────> reject_intervention_add()    rien n'est écrit, la demande reste en historique

L'aperçu et l'approbation passent par la MÊME fonction (build_insertion_plan) :
ce que l'admin a vu est exactement ce qui est écrit.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AccessDeniedError, InvalidReferenceError, ReferenceNotFoundError, StateConflictError
from app.core.tracing import trace
from app.models.catalog import Action, Component, Symptom
from app.models.device import Device, DeviceModel
from app.models.intervention import Diagnosis, Intervention, InterventionAction, InterventionSymptom
from app.models.intervention_add import InterventionAdd
from app.models.technician import Technician
from app.schemas.intervention_add_schema import (
    InsertionPreview,
    InterventionAddRequest,
    PlannedAction,
    PlannedDiagnosis,
    PlannedIntervention,
    PlannedSymptom,
    InterventionAddApproval,
    InterventionAddEdit,
    InterventionAddRejection,
    ReviewedInterventionContent,
)
from app.services import catalog_service, intervention_service, stats_service
from app.services.retrieval_service import store_symptom_embedding
from app.services.solution_proposal_service import load_conversation_for_technician


@dataclass
class InsertionPlan:
    """Les lignes à écrire (preview) + les vecteurs des symptômes, qui ne sont jamais affichés."""

    preview: InsertionPreview
    symptom_vectors: list[list[float]]


@dataclass
class WrittenRows:
    intervention_id: int
    intervention_symptom_ids: list[int]
    intervention_action_ids: list[int]
    diagnosis_id: int | None


# ====================================================================
# Côté technicien
# ====================================================================

def submit_intervention_add(db: Session, submission: InterventionAddRequest) -> InterventionAdd:
    """Enregistre la demande en attente. Aucune table de l'historique n'est touchée."""
    if db.get(Technician, submission.technician_id) is None:
        raise ReferenceNotFoundError(f"Technicien {submission.technician_id} introuvable.")
    if submission.conversation_id is not None:
        load_conversation_for_technician(db, submission.conversation_id, submission.technician_id)

    device = _find_device(db, submission.device_id, submission.device_serial_number)
    content = ReviewedInterventionContent.model_validate(
        {
            **submission.model_dump(exclude={"technician_id", "conversation_id"}),
            "device_id": device.device_id,
            "opened_at": submission.opened_at or datetime.now(timezone.utc),
        }
    )
    stored = content.model_dump(mode="json")

    intervention_add = InterventionAdd(
        technician_id=submission.technician_id,
        conversation_id=submission.conversation_id,
        submitted_content=stored,
        content=stored,
        status="pending",
    )
    db.add(intervention_add)
    db.flush()  # attribue intervention_add_id
    db.commit()
    trace(
        "INTERVENTION_ADD",
        "Demande d'ajout d'intervention reçue, en attente de validation",
        intervention_add_id=intervention_add.intervention_add_id,
        symptom_count=len(content.symptoms),
        action_count=len(content.actions),
    )
    return intervention_add


def get_intervention_add_for_technician(db: Session, intervention_add_id: int, technician_id: int) -> InterventionAdd:
    intervention_add = get_intervention_add(db, intervention_add_id)
    if intervention_add.technician_id != technician_id:
        raise AccessDeniedError("Cette demande appartient à un autre technicien.")
    return intervention_add


# ====================================================================
# Côté administrateur
# ====================================================================

def list_intervention_adds(
    db: Session, status: str | None = None, technician_id: int | None = None, limit: int = 100
) -> list[InterventionAdd]:
    query = db.query(InterventionAdd)
    if status is not None:
        query = query.filter(InterventionAdd.status == status)
    if technician_id is not None:
        query = query.filter(InterventionAdd.technician_id == technician_id)
    return query.order_by(InterventionAdd.created_at.desc(), InterventionAdd.intervention_add_id.desc()).limit(limit).all()


def get_intervention_add(db: Session, intervention_add_id: int, lock: bool = False) -> InterventionAdd:
    # lock : verrouille la ligne jusqu'au commit -- deux admins ne peuvent pas
    # approuver la même demande en même temps (pas d'intervention en double).
    intervention_add = db.get(InterventionAdd, intervention_add_id, with_for_update=lock)
    if intervention_add is None:
        raise ReferenceNotFoundError(f"Demande d'ajout {intervention_add_id} introuvable.")
    return intervention_add


def describe_intervention_add(db: Session, intervention_add: InterventionAdd) -> dict:
    """La demande + des libellés lisibles (technicien, appareil) pour l'écran admin."""
    technician = db.get(Technician, intervention_add.technician_id)
    device_id = (intervention_add.content or {}).get("device_id")
    device = db.get(Device, device_id) if device_id is not None else None
    return {
        "intervention_add_id": intervention_add.intervention_add_id,
        "status": intervention_add.status,
        "technician_id": intervention_add.technician_id,
        "technician_name": getattr(technician, "full_name", None),
        "conversation_id": intervention_add.conversation_id,
        "device_label": _device_label(db, device),
        "created_at": intervention_add.created_at,
        "last_edited_at": intervention_add.last_edited_at,
        "last_edited_by": intervention_add.last_edited_by,
        "edited_by_admin": intervention_add.content != intervention_add.submitted_content,
        "reviewed_at": intervention_add.reviewed_at,
        "reviewed_by": intervention_add.reviewed_by,
        "admin_comment": intervention_add.admin_comment,
        "created_intervention_id": intervention_add.created_intervention_id,
        "content": intervention_add.content,
        "submitted_content": intervention_add.submitted_content,
    }


def update_intervention_add(db: Session, intervention_add_id: int, edit: InterventionAddEdit) -> InterventionAdd:
    """L'admin remplace le contenu (corrections, choix du catalogue). L'envoi d'origine est conservé."""
    intervention_add = get_intervention_add(db, intervention_add_id, lock=True)
    _ensure_pending(intervention_add)
    _check_references(db, edit.content)

    intervention_add.content = edit.content.model_dump(mode="json")
    intervention_add.last_edited_by = edit.edited_by
    intervention_add.last_edited_at = datetime.now(timezone.utc)
    db.commit()
    trace("INTERVENTION_ADD", "Demande d'ajout corrigée par un administrateur", intervention_add_id=intervention_add_id)
    return intervention_add


def preview_intervention_add(db: Session, intervention_add_id: int) -> InsertionPreview:
    """Ce que l'approbation écrirait maintenant. N'écrit rien (appelle seulement le service d'embedding)."""
    intervention_add = get_intervention_add(db, intervention_add_id)
    _ensure_pending(intervention_add)
    return build_insertion_plan(db, intervention_add).preview


def approve_intervention_add(db: Session, intervention_add_id: int, review: InterventionAddApproval) -> tuple[InterventionAdd, InsertionPreview, WrittenRows]:
    """
    Écrit la demande dans l'historique, en une seule transaction : soit toutes
    les lignes sont créées, soit aucune. Les embeddings sont calculés AVANT
    toute écriture : si Voyage ne répond pas, rien n'est écrit (503).
    """
    intervention_add = get_intervention_add(db, intervention_add_id, lock=True)
    _ensure_pending(intervention_add)
    plan = build_insertion_plan(db, intervention_add)

    try:
        written = _write_plan(db, plan)
        _mark_reviewed(intervention_add, "approved", review.reviewed_by, review.admin_comment)
        intervention_add.created_intervention_id = written.intervention_id
        db.commit()
    except Exception:
        db.rollback()
        raise

    # L'écriture est déjà validée ; un échec du recalcul sera signalé en 409.
    stats_service.recompute_stats_safely(db)

    trace(
        "INTERVENTION_ADD",
        "Demande d'ajout approuvée, intervention créée",
        intervention_add_id=intervention_add_id,
        intervention_id=written.intervention_id,
        new_catalog_symptoms=len(plan.preview.new_catalog_symptoms),
        new_catalog_actions=len(plan.preview.new_catalog_actions),
    )
    return intervention_add, plan.preview, written


def reject_intervention_add(db: Session, intervention_add_id: int, review: InterventionAddRejection) -> InterventionAdd:
    intervention_add = get_intervention_add(db, intervention_add_id, lock=True)
    _ensure_pending(intervention_add)
    _mark_reviewed(intervention_add, "rejected", review.reviewed_by, review.admin_comment)
    db.commit()
    trace("INTERVENTION_ADD", "Demande d'ajout rejetée", intervention_add_id=intervention_add_id)
    return intervention_add


def _ensure_pending(intervention_add: InterventionAdd) -> None:
    # Une décision est définitive : la revoir écraserait l'historique.
    if intervention_add.status != "pending":
        raise StateConflictError(f"La demande d'ajout {intervention_add.intervention_add_id} a déjà été examinée (statut : {intervention_add.status}).")


def _mark_reviewed(intervention_add: InterventionAdd, status: str, reviewed_by: str, admin_comment: str | None) -> None:
    intervention_add.status = status
    intervention_add.reviewed_by = reviewed_by
    intervention_add.reviewed_at = datetime.now(timezone.utc)
    intervention_add.admin_comment = (admin_comment or "").strip() or None


# ====================================================================
# Plan d'écriture : quelle ligne va dans quelle table
# ====================================================================

def build_insertion_plan(db: Session, intervention_add: InterventionAdd) -> InsertionPlan:
    content = ReviewedInterventionContent.model_validate(intervention_add.content)
    device = _check_references(db, content)
    if db.get(Technician, intervention_add.technician_id) is None:
        raise ReferenceNotFoundError(f"Technicien {intervention_add.technician_id} introuvable.")

    symptoms, symptom_vectors = _plan_symptoms(db, content, device.device_type)
    actions = _plan_actions(db, content)
    diagnosis = (
        PlannedDiagnosis(**content.diagnosis.model_dump(include={"description", "confirmed", "root_cause_component_id"}))
        if content.diagnosis
        else None
    )

    preview = InsertionPreview(
        intervention_add_id=intervention_add.intervention_add_id,
        intervention=PlannedIntervention(
            device_id=content.device_id,
            technician_id=intervention_add.technician_id,
            ticket_reference=content.ticket_reference,
            opened_at=content.opened_at or intervention_add.created_at or datetime.now(timezone.utc),
            closed_at=content.closed_at,
            final_outcome_status=content.final_outcome_status,
            summary_text=content.summary_text,
        ),
        intervention_symptom=symptoms,
        intervention_action=actions,
        diagnosis=diagnosis,
        new_catalog_symptoms=_unique_texts(s.catalog_text for s in symptoms if s.catalog_link == "new_catalog_entry"),
        new_catalog_actions=_unique_texts(a.catalog_text for a in actions if a.catalog_link == "new_catalog_entry"),
    )
    return InsertionPlan(preview=preview, symptom_vectors=symptom_vectors)


def _plan_symptoms(db: Session, content: ReviewedInterventionContent, device_type: str) -> tuple[list[PlannedSymptom], list]:
    """Chaque symptôme : son vecteur, et son entrée du catalogue (choisie, retrouvée ou nouvelle)."""
    embedded = intervention_service.embed_symptoms_and_match_catalog(
        db, [symptom.text for symptom in content.symptoms], device_type
    )
    planned, vectors = [], []
    for number, (symptom, (vector, match)) in enumerate(zip(content.symptoms, embedded), start=1):
        if symptom.catalog_symptom_id is not None:
            link, entry, distance = "chosen_by_admin", db.get(Symptom, symptom.catalog_symptom_id), None
        elif match is not None:
            link, entry, distance = "matched_existing", db.get(Symptom, match["symptom_id"]), match["distance"]
        else:
            link, entry, distance = "new_catalog_entry", None, None

        planned.append(
            PlannedSymptom(
                number=number,
                raw_text=symptom.text,
                severity=symptom.severity,
                symptom_id=getattr(entry, "symptom_id", None),
                catalog_link=link,
                catalog_text=getattr(entry, "canonical_text", None) or symptom.catalog_text or symptom.text,
                match_distance=distance,
            )
        )
        vectors.append(vector)
    return planned, vectors


def _plan_actions(db: Session, content: ReviewedInterventionContent) -> list[PlannedAction]:
    """Chaque action : son entrée du catalogue (choisie, retrouvée sans doublon, ou nouvelle)."""
    texts_to_match = [action.text for action in content.actions if action.catalog_action_id is None]
    rankings = iter(catalog_service.rank_catalog_actions(db, texts_to_match, limit=1) if texts_to_match else [])

    planned = []
    for order, action in enumerate(content.actions, start=1):
        entry, distance = None, None
        if action.catalog_action_id is not None:
            link, entry = "chosen_by_admin", db.get(Action, action.catalog_action_id)
        else:
            closest = next(iter(next(rankings)), None)
            if closest is not None and closest["distance"] <= settings.action_catalog_match_max_distance:
                link, entry, distance = "matched_existing", db.get(Action, closest["action_id"]), closest["distance"]
            else:
                link = "new_catalog_entry"

        planned.append(
            PlannedAction(
                sequence_order=order,
                raw_text=action.text,
                result_description=action.result_description,
                outcome_status=action.outcome_status,
                is_confirmed_solution=action.is_confirmed_solution,
                targets_symptom_number=action.targets_symptom_number,
                action_id=getattr(entry, "action_id", None),
                catalog_link=link,
                catalog_text=getattr(entry, "canonical_text", None) or action.catalog_text or action.text,
                match_distance=distance,
            )
        )
    return planned


def _write_plan(db: Session, plan: InsertionPlan) -> WrittenRows:
    """Exécute le plan. flush seulement : c'est approve_intervention_add qui valide (commit) ou annule tout."""
    preview = plan.preview

    # 1. Catalogue : les nouvelles entrées d'abord, pour avoir leurs ID.
    #    Même texte deux fois dans la demande = une seule entrée.
    new_symptom_ids: dict[str, int] = {}
    for planned in preview.intervention_symptom:
        if planned.catalog_link == "new_catalog_entry":
            key = planned.catalog_text.casefold()
            if key not in new_symptom_ids:
                entry = Symptom(canonical_text=planned.catalog_text)
                db.add(entry)
                db.flush()
                new_symptom_ids[key] = entry.symptom_id
            planned.symptom_id = new_symptom_ids[key]

    new_action_ids: dict[str, int] = {}
    for planned in preview.intervention_action:
        if planned.catalog_link == "new_catalog_entry":
            key = planned.catalog_text.casefold()
            if key not in new_action_ids:
                new_action_ids[key] = catalog_service.create_action_in_catalog(db, planned.catalog_text).action_id
            planned.action_id = new_action_ids[key]

    # 2. intervention : la visite.
    intervention = Intervention(**preview.intervention.model_dump())
    db.add(intervention)
    db.flush()

    # 3. intervention_symptom : les problèmes, puis leur vecteur (colonne non mappée, SQL direct).
    symptom_rows = []
    for planned in preview.intervention_symptom:
        row = InterventionSymptom(
            intervention_id=intervention.intervention_id,
            symptom_id=planned.symptom_id,
            raw_text=planned.raw_text,
            severity=planned.severity,
        )
        db.add(row)
        symptom_rows.append(row)
    db.flush()
    for row, vector in zip(symptom_rows, plan.symptom_vectors):
        store_symptom_embedding(db, row.intervention_symptom_id, vector)

    # 4. intervention_action : dans l'ordre de la demande ; le numéro de symptôme devient son ID.
    action_rows = []
    for planned in preview.intervention_action:
        target = planned.targets_symptom_number
        row = InterventionAction(
            intervention_id=intervention.intervention_id,
            action_id=planned.action_id,
            raw_text=planned.raw_text,
            sequence_order=planned.sequence_order,
            result_description=planned.result_description,
            outcome_status=planned.outcome_status,
            is_confirmed_solution=planned.is_confirmed_solution,
            targets_symptom_id=symptom_rows[target - 1].intervention_symptom_id if target else None,
        )
        db.add(row)
        action_rows.append(row)

    # 5. diagnosis : la cause, si le technicien l'a trouvée.
    diagnosis_row = None
    if preview.diagnosis is not None:
        diagnosis_row = Diagnosis(intervention_id=intervention.intervention_id, **preview.diagnosis.model_dump())
        db.add(diagnosis_row)
    db.flush()

    return WrittenRows(
        intervention_id=intervention.intervention_id,
        intervention_symptom_ids=[row.intervention_symptom_id for row in symptom_rows],
        intervention_action_ids=[row.intervention_action_id for row in action_rows],
        diagnosis_id=getattr(diagnosis_row, "diagnosis_id", None),
    )


# ====================================================================
# Vérifications et libellés
# ====================================================================

def _check_references(db: Session, content: ReviewedInterventionContent) -> Device:
    """Tous les ID du contenu existent bien (404 sinon). Renvoie l'appareil."""
    device = db.get(Device, content.device_id)
    if device is None:
        raise ReferenceNotFoundError(f"Appareil {content.device_id} introuvable.")
    for number, symptom in enumerate(content.symptoms, start=1):
        if symptom.catalog_symptom_id is not None and db.get(Symptom, symptom.catalog_symptom_id) is None:
            raise ReferenceNotFoundError(f"Symptôme {number} : symptom {symptom.catalog_symptom_id} introuvable au catalogue.")
    for number, action in enumerate(content.actions, start=1):
        if action.catalog_action_id is not None and db.get(Action, action.catalog_action_id) is None:
            raise ReferenceNotFoundError(f"Action {number} : action {action.catalog_action_id} introuvable au catalogue.")
    component_id = content.diagnosis.root_cause_component_id if content.diagnosis else None
    if component_id is not None and db.get(Component, component_id) is None:
        raise ReferenceNotFoundError(f"Composant {component_id} introuvable.")
    return device


def _find_device(db: Session, device_id: int | None, serial_number: str | None) -> Device:
    if device_id is not None:
        device = db.get(Device, device_id)
        if device is None:
            raise ReferenceNotFoundError(f"Appareil {device_id} introuvable.")
        return device

    # serial_number n'est pas unique en base (saisie terrain) : il doit désigner UN seul appareil.
    matches = db.query(Device).filter(Device.serial_number == serial_number.strip()).limit(2).all()
    if not matches:
        raise ReferenceNotFoundError(f"Aucun appareil avec le numéro de série « {serial_number} ».")
    if len(matches) > 1:
        raise InvalidReferenceError(f"Plusieurs appareils ont le numéro de série « {serial_number} » : indiquez device_id.")
    return matches[0]


def _device_label(db: Session, device: Device | None) -> str | None:
    if device is None:
        return None
    model = db.get(DeviceModel, device.model_id) if device.model_id else None
    parts = (device.device_type.upper(), getattr(model, "model_name", None), device.site_name or device.serial_number)
    return " · ".join(part for part in parts if part)


def _unique_texts(texts) -> list[str]:
    seen, unique = set(), []
    for text in texts:
        if text.casefold() not in seen:
            seen.add(text.casefold())
            unique.append(text)
    return unique
