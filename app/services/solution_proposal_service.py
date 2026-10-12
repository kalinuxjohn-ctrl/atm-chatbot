"""
Propositions de solution : quand aucune solution trouvée par le Copilote n'a
marché, le technicien propose la sienne, et un administrateur la valide.

    technicien ── GET  contexte ──> get_proposal_context()   (lecture seule)
               ── POST proposition ─> create_proposal()       (status pending)
    admin      ── approuver ────────> approve_proposal()      (-> catalogue + rattachement au problème)
               ── rejeter ─────────> reject_proposal()        (conservée pour l'historique)

Le BACKEND est la source de vérité : le problème actif est toujours relu
dans conversation_context (dernière recherche + résultat sélectionné), y
compris à l'envoi -- le frontend ne transmet que l'action et le résultat.

« Cas de référence » : la conversation n'est pas encore rattachée à une
intervention EN COURS. Le problème est donc relié au cas passé qui lui
correspond (résultat sélectionné par le technicien, sinon le premier
résultat de la recherche) : c'est de lui que viennent intervention_id,
intervention_symptom_id, symptom_id et component_id. device_id reste vide :
seuls le type (GAB/TPE) et le modèle de l'appareil en panne sont connus.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AccessDeniedError, InvalidReferenceError, ReferenceNotFoundError, StateConflictError
from app.core.tracing import trace
from app.models.catalog import Action, Component, Symptom
from app.models.conversation import Conversation
from app.models.device import DeviceModel
from app.models.fault import ErrorCode
from app.models.intervention import Intervention, InterventionAction
from app.models.solution_proposal import SolutionProposal
from app.models.technician import Technician
from app.schemas.solution_proposal_schema import ProposalApproval, ProposalRejection, SolutionProposalCreate
from app.services import catalog_service, context_service, conversation_service, stats_service

PROPOSAL_RECORDED_REPLY = (
    "Votre proposition a été enregistrée et sera examinée par un administrateur. "
    "Merci : si elle est validée, elle aidera les prochains techniciens. "
    "Vous pouvez continuer la conversation."
)
NO_ACTIVE_PROBLEM_MESSAGE = (
    "Aucun problème n'est encore identifié dans cette conversation : "
    "décrivez d'abord la panne au Copilote, puis proposez votre solution."
)
# Messages référencés dans le snapshot (par leur ID, sans recopier leur texte).
RECENT_MESSAGE_COUNT = 10


@dataclass
class ActiveProblem:
    """Le problème actif de la conversation, tel que le backend le reconstitue."""

    problem_text: str
    ids: dict
    problem: dict
    reference_position: int | None
    previous_results: list[dict] = field(default_factory=list)


# ====================================================================
# Côté technicien
# ====================================================================

def get_proposal_context(db: Session, conversation_id: int, technician_id: int) -> dict:
    """Ce que le formulaire de proposition affiche. Ne modifie rien."""
    load_conversation_for_technician(db, conversation_id, technician_id)
    active = _resolve_active_problem(db, context_service.get_context(db, conversation_id))
    trace(
        "PROPOSAL",
        "Contexte de proposition préparé",
        conversation_id=conversation_id,
        has_reference_case=active.ids["intervention_id"] is not None,
        previous_result_count=len(active.previous_results),
    )
    return {
        "conversation_id": conversation_id,
        "context": active.ids,
        "problem": active.problem,
        "reference_position": active.reference_position,
        "previous_results": active.previous_results,
    }


def create_proposal(db: Session, conversation_id: int, payload: SolutionProposalCreate) -> SolutionProposal:
    """
    Enregistre la proposition (status pending). Le contexte est RELU ici,
    pas repris du formulaire : si une nouvelle recherche a eu lieu entre-temps,
    c'est elle qui fait foi.
    """
    conversation = load_conversation_for_technician(db, conversation_id, payload.technician_id)
    context = context_service.get_context(db, conversation_id)
    active = _resolve_active_problem(db, context)

    recent_message_ids = [
        message.message_id
        for message in conversation_service.get_recent_messages(db, conversation_id, limit=RECENT_MESSAGE_COUNT)
    ]
    proposal = SolutionProposal(
        conversation_id=conversation_id,
        technician_id=payload.technician_id,
        intervention_id=active.ids["intervention_id"],
        intervention_symptom_id=active.ids["intervention_symptom_id"],
        symptom_id=active.ids["symptom_id"],
        component_id=active.ids["component_id"],
        device_id=active.ids["device_id"],
        device_type=active.ids["device_type"],
        model_id=active.ids["model_id"],
        error_code_id=active.ids["error_code_id"],
        problem_text=active.problem_text,
        proposed_action=payload.proposed_action,
        result_description=payload.result_description,
        outcome_status=payload.outcome_status,
        conversation_context_snapshot=_build_snapshot(context, active, recent_message_ids),
        status="pending",
    )
    db.add(proposal)
    db.flush()  # attribue proposal_id

    # La conversation continue normalement : la réponse rejoint l'historique,
    # et le contexte garde sa dernière recherche (« détaille le deuxième » marche encore).
    conversation_service.save_message(db, conversation_id, "assistant", PROPOSAL_RECORDED_REPLY)
    context["last_solution_proposal"] = {"proposal_id": proposal.proposal_id, "status": "pending"}
    context_service.save_context(db, conversation_id, context)
    conversation_service.mark_conversation_active(conversation)
    db.commit()

    trace(
        "PROPOSAL",
        "Proposition de solution enregistrée",
        proposal_id=proposal.proposal_id,
        conversation_id=conversation_id,
        has_reference_case=proposal.intervention_id is not None,
    )
    return proposal


def load_conversation_for_technician(db: Session, conversation_id: int, technician_id: int) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise ReferenceNotFoundError(f"Conversation {conversation_id} introuvable.")
    if conversation.technician_id != technician_id:
        raise AccessDeniedError("Cette conversation appartient à un autre technicien.")
    return conversation


# ====================================================================
# Côté administrateur
# ====================================================================

def list_proposals(db: Session, status: str | None = None, limit: int = 100) -> list[SolutionProposal]:
    query = db.query(SolutionProposal)
    if status is not None:
        query = query.filter(SolutionProposal.status == status)
    return query.order_by(SolutionProposal.created_at.desc(), SolutionProposal.proposal_id.desc()).limit(limit).all()


def get_proposal(db: Session, proposal_id: int) -> SolutionProposal:
    proposal = db.get(SolutionProposal, proposal_id)
    if proposal is None:
        raise ReferenceNotFoundError(f"Proposition {proposal_id} introuvable.")
    return proposal


def describe_proposal(db: Session, proposal: SolutionProposal) -> dict:
    """Proposition + libellés lisibles (technicien, composant, modèle, code) pour l'écran admin."""
    snapshot = proposal.conversation_context_snapshot or {}
    technician = db.get(Technician, proposal.technician_id)
    component = db.get(Component, proposal.component_id) if proposal.component_id else None
    model = db.get(DeviceModel, proposal.model_id) if proposal.model_id else None
    error_code = db.get(ErrorCode, proposal.error_code_id) if proposal.error_code_id else None
    return {
        "proposal_id": proposal.proposal_id,
        "status": proposal.status,
        "created_at": proposal.created_at,
        "conversation_id": proposal.conversation_id,
        "technician_id": proposal.technician_id,
        "technician_name": getattr(technician, "full_name", None),
        "intervention_id": proposal.intervention_id,
        "intervention_symptom_id": proposal.intervention_symptom_id,
        "symptom_id": proposal.symptom_id,
        "component_id": proposal.component_id,
        "component_name": getattr(component, "name", None),
        "device_id": proposal.device_id,
        "device_type": proposal.device_type,
        "model_name": getattr(model, "model_name", None) or snapshot.get("model_name"),
        "error_code": getattr(error_code, "code", None) or snapshot.get("error_code"),
        "problem_text": proposal.problem_text,
        "problem_label": (snapshot.get("problem") or {}).get("label") or proposal.problem_text,
        "proposed_action": proposal.proposed_action,
        "result_description": proposal.result_description,
        "outcome_status": proposal.outcome_status,
        "previous_results": snapshot.get("previous_results") or [],
        "conversation_context_snapshot": snapshot,
        "reviewed_at": proposal.reviewed_at,
        "reviewed_by": proposal.reviewed_by,
        "admin_comment": proposal.admin_comment,
        "approved_action_id": proposal.approved_action_id,
    }


def approve_proposal(
    db: Session, proposal_id: int, review: ProposalApproval
) -> tuple[SolutionProposal, str, InterventionAction | None]:
    """
    Approuve, en deux temps :

    1. Catalogue d'actions, SANS créer de doublon : action choisie par
       l'administrateur (existing_action_id), sinon action déjà au catalogue
       assez proche (catalog_service.find_similar_actions), sinon nouvelle action.
       Si le service d'embedding ne répond pas, l'approbation échoue (503)
       plutôt que de créer une action sans avoir pu vérifier les doublons.
    2. Rattachement au problème : une intervention_action est ajoutée au cas de
       référence, ciblant le symptôme du problème (targets_symptom_id). Ce
       symptôme a déjà son embedding : la prochaine recherche qui le retrouve
       affiche aussi cette solution. Aucun vecteur n'est recalculé.

    Renvoie la proposition, le type d'intégration au catalogue, et l'action
    rattachée (None si la proposition n'a pas de cas de référence).
    """
    proposal = get_proposal(db, proposal_id)
    _ensure_pending(proposal)
    canonical_text = (review.canonical_text or "").strip() or proposal.proposed_action

    try:
        if review.existing_action_id is not None:
            if db.get(Action, review.existing_action_id) is None:
                raise ReferenceNotFoundError(f"Action {review.existing_action_id} introuvable dans le catalogue.")
            action_id, integration = review.existing_action_id, "existing_action_linked"
        else:
            candidates = catalog_service.find_similar_actions(db, canonical_text, limit=1)
            closest = candidates[0] if candidates else None
            if closest is not None and closest["distance"] <= settings.solution_proposal_duplicate_max_distance:
                action_id, integration = closest["action_id"], "existing_action_reused"
            else:
                action_id = catalog_service.create_action_in_catalog(db, canonical_text, proposal.component_id).action_id
                integration = "action_created"

        attached_action = _attach_to_problem(db, proposal, action_id)
        _mark_reviewed(proposal, "approved", review.reviewed_by, review.admin_comment)
        proposal.approved_action_id = action_id
        db.commit()
    except Exception:
        db.rollback()
        raise

    # Après le commit, comme catalog_service : un échec du recalcul ne doit
    # pas annuler l'approbation (les stats se reconstruiront au prochain calcul).
    if attached_action is not None:
        stats_service.recompute_stats_safely(db)

    trace(
        "PROPOSAL",
        "Proposition approuvée",
        proposal_id=proposal_id,
        integration=integration,
        action_id=action_id,
        attached_to_problem=attached_action is not None,
    )
    return proposal, integration, attached_action


def _attach_to_problem(db: Session, proposal: SolutionProposal, action_id: int) -> InterventionAction | None:
    """
    Accroche la solution au problème qu'elle résout : une nouvelle action de
    l'intervention de référence, qui cible le symptôme concerné. Elle est
    marquée source_proposal_id pour ne jamais passer pour une action faite
    pendant la visite d'origine.
    """
    if proposal.intervention_id is None or proposal.intervention_symptom_id is None:
        trace("PROPOSAL", "Aucun cas de référence, solution gardée au catalogue seulement", proposal_id=proposal.proposal_id)
        return None

    intervention = db.get(Intervention, proposal.intervention_id)
    symptom_ids = {symptom.intervention_symptom_id for symptom in getattr(intervention, "symptoms", None) or []}
    if intervention is None or proposal.intervention_symptom_id not in symptom_ids:
        trace("PROPOSAL", "Cas de référence introuvable, solution gardée au catalogue seulement", proposal_id=proposal.proposal_id)
        return None

    next_order = max((action.sequence_order for action in intervention.actions or []), default=0) + 1
    attached = InterventionAction(
        intervention_id=intervention.intervention_id,
        action_id=action_id,
        raw_text=proposal.proposed_action,
        sequence_order=next_order,
        result_description=proposal.result_description,
        outcome_status=proposal.outcome_status,
        # « Réglé en partie » reste visible, mais ne compte pas comme un succès dans les stats.
        is_confirmed_solution=proposal.outcome_status == "resolved",
        targets_symptom_id=proposal.intervention_symptom_id,
        source_proposal_id=proposal.proposal_id,
    )
    db.add(attached)
    db.flush()
    return attached


def reject_proposal(db: Session, proposal_id: int, review: ProposalRejection) -> SolutionProposal:
    """La proposition reste en base (historique) mais ne rejoint pas le catalogue."""
    proposal = get_proposal(db, proposal_id)
    _ensure_pending(proposal)
    _mark_reviewed(proposal, "rejected", review.reviewed_by, review.admin_comment)
    db.commit()
    trace("PROPOSAL", "Proposition rejetée", proposal_id=proposal_id)
    return proposal


def _ensure_pending(proposal: SolutionProposal) -> None:
    # Une décision est définitive : la revoir écraserait l'historique.
    if proposal.status != "pending":
        raise StateConflictError(
            f"La proposition {proposal.proposal_id} a déjà été examinée (statut : {proposal.status})."
        )


def _mark_reviewed(proposal: SolutionProposal, status: str, reviewed_by: str, admin_comment: str | None) -> None:
    proposal.status = status
    proposal.reviewed_by = reviewed_by
    proposal.reviewed_at = datetime.now(timezone.utc)
    proposal.admin_comment = (admin_comment or "").strip() or None


# ====================================================================
# Reconstitution du problème actif à partir du contexte
# ====================================================================

def _resolve_active_problem(db: Session, context: dict) -> ActiveProblem:
    last_search = context.get("last_search") or {}
    problem_text = (last_search.get("query") or "").strip()
    if not problem_text:
        raise StateConflictError(NO_ACTIVE_PROBLEM_MESSAGE)

    device_type = context.get("device_type")
    if device_type not in ("gab", "tpe"):
        raise StateConflictError("Le type d'appareil (GAB ou TPE) de cette conversation n'est pas connu.")

    results = [result for result in last_search.get("results") or [] if isinstance(result, dict)]
    reference = _pick_reference_result(context, results)

    ids = {
        "intervention_id": None,
        "intervention_symptom_id": None,
        "symptom_id": None,
        "component_id": None,
        "device_id": None,
        "device_type": device_type,
        "model_id": context.get("model_id"),
        "error_code_id": context.get("error_code_id"),
    }

    symptom_id = None
    if reference is not None and _result_kind(reference) == "case":
        intervention = db.get(Intervention, reference.get("intervention_id"))
        if intervention is None:
            raise StateConflictError("Le cas de référence de la dernière recherche n'existe plus : relancez une recherche.")
        reference_device = getattr(intervention, "device", None)
        if reference_device is not None and reference_device.device_type != device_type:
            raise InvalidReferenceError(f"Le cas de référence ne concerne pas un {device_type.upper()}.")
        matched = _find_matched_symptom(intervention, reference)
        ids["intervention_id"] = intervention.intervention_id
        ids["intervention_symptom_id"] = matched.intervention_symptom_id if matched else None
        symptom_id = matched.symptom_id if matched else None
    elif reference is not None:
        symptom_id = reference.get("symptom_id")

    symptom = db.get(Symptom, symptom_id) if symptom_id else None
    if symptom is not None:
        ids["symptom_id"] = symptom.symptom_id
        ids["component_id"] = symptom.component_id
    component = db.get(Component, ids["component_id"]) if ids["component_id"] else None
    model = db.get(DeviceModel, ids["model_id"]) if ids["model_id"] else None
    error_code = db.get(ErrorCode, ids["error_code_id"]) if ids["error_code_id"] else None

    model_name = getattr(model, "model_name", None) or context.get("model_name")
    problem = {
        "label": getattr(symptom, "canonical_text", None) or problem_text,
        "description": problem_text,
        "component_name": getattr(component, "name", None),
        "device_label": " · ".join(part for part in (device_type.upper(), model_name) if part),
        "error_code": getattr(error_code, "code", None) or context.get("error_code"),
    }
    return ActiveProblem(
        problem_text=problem_text,
        ids=ids,
        problem=problem,
        reference_position=reference.get("position") if reference else None,
        previous_results=[_describe_result(db, result) for result in results],
    )


def _pick_reference_result(context: dict, results: list[dict]) -> dict | None:
    """Le résultat que le technicien a approfondi (« détaille le deuxième »), sinon le meilleur."""
    selected = context.get("selected_result") or {}
    for result in results:
        if selected.get("position") is not None and result.get("position") == selected["position"]:
            return result
    return results[0] if results else None


def _result_kind(result: dict) -> str:
    # Même règle que chat_orchestrator_service._infer_legacy_kind pour les anciens contextes.
    return result.get("kind") or ("case" if "intervention_id" in result else "stat")


def _find_matched_symptom(intervention: Intervention, result: dict):
    """
    Le symptôme de l'intervention qui a fait remonter ce cas. Les recherches
    récentes mémorisent son ID ; les plus anciennes seulement son texte.
    """
    symptoms = list(intervention.symptoms or [])
    wanted_id = result.get("matched_intervention_symptom_id")
    wanted_text = (result.get("matched_symptom_text") or "").strip()
    return (
        next((s for s in symptoms if wanted_id is not None and s.intervention_symptom_id == wanted_id), None)
        or next((s for s in symptoms if wanted_text and s.raw_text.strip() == wanted_text), None)
        or next((s for s in symptoms if s.symptom_id is not None), None)
        or (symptoms[0] if symptoms else None)
    )


def _describe_result(db: Session, result: dict) -> dict:
    """Un résultat de la recherche, avec la solution que le Copilote en a tirée."""
    kind = _result_kind(result)
    described = {
        "position": result.get("position"),
        "kind": kind,
        "intervention_id": None,
        "intervention_symptom_id": None,
        "symptom_text": result.get("matched_symptom_text") or result.get("symptom_text"),
        "solution_text": result.get("action_text"),
    }
    if kind == "case":
        intervention = db.get(Intervention, result.get("intervention_id"))
        described["intervention_id"] = result.get("intervention_id")
        if intervention is not None:
            matched = _find_matched_symptom(intervention, result)
            described["intervention_symptom_id"] = matched.intervention_symptom_id if matched else None
            actions = sorted(intervention.actions or [], key=lambda action: action.sequence_order)
            confirmed = [action for action in actions if action.is_confirmed_solution]
            chosen = confirmed or actions[-1:]
            # Toutes les solutions confirmées du cas : celle de la visite ET celles validées ensuite.
            described["solution_text"] = " / ".join(action.raw_text for action in chosen) or None
    return described


def _build_snapshot(context: dict, active: ActiveProblem, recent_message_ids: list[int]) -> dict:
    """Photo du contexte au moment de la proposition : de quoi comprendre sans relire tout le chat."""
    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "intent": context.get("intent"),
        "device_type": active.ids["device_type"],
        "model_id": active.ids["model_id"],
        "model_name": context.get("model_name"),
        "error_code_id": active.ids["error_code_id"],
        "error_code": context.get("error_code"),
        "reference": {key: value for key, value in active.ids.items() if key not in ("device_type", "model_id", "error_code_id")},
        "reference_position": active.reference_position,
        "problem": active.problem,
        "last_search": context.get("last_search"),
        "selected_result": context.get("selected_result"),
        "previous_results": active.previous_results,
        "recent_message_ids": recent_message_ids,
    }
