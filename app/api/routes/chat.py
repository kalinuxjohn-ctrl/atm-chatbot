"""
Route HTTP pour la recherche de symptôme (le point d'entrée du flux du
technicien) :
- POST /chat/search-symptom : le technicien décrit ce qu'il observe sur un
  GAB ou un TPE, l'API renvoie les solutions déjà connues, classées par
  accuracy décroissante.

Aucune logique métier ici : tout est délégué à retrieval_service.py.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.tracing import trace
from app.schemas.conversation_schema import ChatRequest, ChatResponse
from app.services import chat_orchestrator_service 

from app.core.database import get_db
from app.schemas.chat_schema import SymptomSearchRequest, SymptomSearchResponse
from app.services.retrieval_service import find_ranked_solutions
from app.services.llm_service import summarize_solutions

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
        result = find_ranked_solutions(db, raw_text=payload.raw_text, device_type=payload.device_type)
        resume = summarize_solutions(payload.raw_text, result["solutions"])
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