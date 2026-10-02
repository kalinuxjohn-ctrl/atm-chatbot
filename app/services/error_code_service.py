"""
Recherche classique (SQL, sans IA) de codes d'erreur.

Volontairement indépendant de retrieval_service.py / embeddings_service.py
-- voir la feuille de route, "Recherche de code d'erreur" ne passe jamais
par le pipeline vectoriel (pas d'embedding, pas de pgvector, pas de LLM).
"""

from sqlalchemy.orm import Session, joinedload

from app.models.fault import ErrorCode


def search_error_codes(db: Session, query: str) -> list[ErrorCode]:
    """
    Recherche par code, exacte ou partielle, insensible à la casse.

    ILIKE '%...%' couvre les trois cas demandés en une seule requête : une
    recherche exacte ('E42') est juste un cas particulier d'une recherche
    partielle qui matche tout. joinedload évite une requête supplémentaire
    par résultat pour charger la panne liée (fault).
    """
    motif = f"%{query.strip()}%"
    return (
        db.query(ErrorCode)
        .options(joinedload(ErrorCode.fault))
        .filter(ErrorCode.code.ilike(motif))
        .order_by(ErrorCode.code)
        .all()
    )