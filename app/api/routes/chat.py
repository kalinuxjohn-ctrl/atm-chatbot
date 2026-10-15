"""
Route HTTP pour la recherche de symptôme (le point d'entrée du flux du
technicien) :
- POST /chat/search-symptom : le technicien décrit ce qu'il observe sur un
  GAB ou un TPE, l'API renvoie les solutions déjà connues, classées par
  accuracy décroissante.
- POST /chat : message du technicien, routé par chat_orchestrator_service.
- GET  /chat/conversations/{id}/solution-proposal-context : problème actif
  à afficher quand aucune solution proposée n'a marché.
- POST /chat/conversations/{id}/solution-proposals : proposition du
  technicien (voir solution_proposal_service).

Aucune logique métier ici : tout est délégué à retrieval_service.py.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.tracing import trace
from app.schemas.conversation_schema import ChatRequest, ChatResponse
from app.services import chat_orchestrator_service 

from app.core.database import get_db
from app.schemas.chat_schema import SymptomSearchRequest, SymptomSearchResponse
from app.services.retrieval_service import find_ranked_solutions
from app.services.llm_service import summarize_solutions
from app.services.text_validation_service import REFORMULATION_REPLY, validate_and_clean_message
from app.schemas.solution_proposal_schema import (
    ProposalContextResponse,
    SolutionProposalCreate,
    SolutionProposalCreated,
)
from app.services import solution_proposal_service

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/search-symptom", response_model=SymptomSearchResponse)
def rechercher_symptome(payload: SymptomSearchRequest, db: Session = Depends(get_db)) -> SymptomSearchResponse:
    """
    Retrouve les symptômes catalogués les plus proches de la description du
    technicien (recherche vectorielle, restreinte au même device_type), puis
    renvoie les actions déjà tentées pour ces symptômes, classées par
    accuracy décroissante -- aucun résultat n'est masqué.
    """

    trace(
        "REQUEST",
        "Requête de recherche de symptôme reçue",
        endpoint="/chat/search-symptom",
        device_type=payload.device_type,
        message_length=len(payload.raw_text),
    )
    try:
        validation = validate_and_clean_message(payload.raw_text)
        trace(
            "VALIDATION",
            "Texte de recherche évalué",
            valid=validation.valid,
            reason=validation.reason,
        )
        if not validation.valid:
            return SymptomSearchResponse(summary=REFORMULATION_REPLY)
        result = find_ranked_solutions(db, search_text=validation.cleaned_text, device_type=payload.device_type)
        resume = summarize_solutions(validation.cleaned_text, result["solutions"], device_type=payload.device_type)
        response = SymptomSearchResponse(**result, summary=resume)
    except Exception as error:
        trace(
            "ERROR",
            "Échec de la requête de recherche de symptôme",
            endpoint="/chat/search-symptom",
            error_type=type(error).__name__,
        )
        raise

    trace(
        "RESPONSE",
        "Réponse de recherche de symptôme envoyée",
        endpoint="/chat/search-symptom",
        result_count=len(result["solutions"]),
    )
    return response


@router.post("", response_model=ChatResponse)
def chat(payload: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    trace(
        "REQUEST",
        "Message utilisateur reçu",
        endpoint="/chat",
        conversation_id=payload.conversation_id,
        message_length=len(payload.message),
    )
    try:
        resultat = chat_orchestrator_service.handle_chat_message(
            db=db,
            conversation_id=payload.conversation_id,
            technician_id=payload.technician_id,
            message=payload.message,
            device_type=payload.device_type,
        )
        response = ChatResponse(**resultat)
    except Exception as error:
        trace(
            "ERROR",
            "Échec du traitement du message utilisateur",
            endpoint="/chat",
            conversation_id=payload.conversation_id,
            error_type=type(error).__name__,
        )
        raise

    trace(
        "RESPONSE",
        "Réponse finale envoyée",
        endpoint="/chat",
        conversation_id=resultat["conversation_id"],
    )
    return response


@router.get(
    "/conversations/{conversation_id}/solution-proposal-context",
    response_model=ProposalContextResponse,
)
def lire_contexte_proposition(
    conversation_id: int,
    technician_id: int = Query(..., description="TODO: remplacer par la dépendance d'auth existante si disponible"),
    db: Session = Depends(get_db),
) -> ProposalContextResponse:
    """Problème actif de la conversation, relu côté serveur (409 si aucun problème n'est identifié)."""
    trace("REQUEST", "Contexte de proposition demandé", endpoint="/chat/.../solution-proposal-context", conversation_id=conversation_id)
    return ProposalContextResponse(
        **solution_proposal_service.get_proposal_context(db, conversation_id, technician_id)
    )


@router.post(
    "/conversations/{conversation_id}/solution-proposals",
    response_model=SolutionProposalCreated,
    status_code=201,
)
def proposer_solution(
    conversation_id: int, payload: SolutionProposalCreate, db: Session = Depends(get_db)
) -> SolutionProposalCreated:
    """Enregistre la proposition (pending) ; le problème associé est déterminé par le backend."""
    trace("REQUEST", "Proposition de solution reçue", endpoint="/chat/.../solution-proposals", conversation_id=conversation_id)
    proposal = solution_proposal_service.create_proposal(db, conversation_id, payload)
    return SolutionProposalCreated(
        proposal_id=proposal.proposal_id,
        status=proposal.status,
        reply=solution_proposal_service.PROPOSAL_RECORDED_REPLY,
    )
