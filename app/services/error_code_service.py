"""
Recherche classique (SQL, sans IA) de codes d'erreur.

Volontairement indépendant de retrieval_service.py / embeddings_service.py
-- voir la feuille de route, "Recherche de code d'erreur" ne passe jamais
par le pipeline vectoriel (pas d'embedding, pas de pgvector, pas de LLM).
"""

from sqlalchemy.orm import Session, joinedload

from app.core.tracing import trace
from app.models.fault import ErrorCode


def search_error_codes(db: Session, query: str) -> list[ErrorCode]:
    """
    Recherche par code, exacte ou partielle, insensible à la casse.

    ILIKE '%...%' couvre les trois cas demandés en une seule requête : une
    recherche exacte ('E42') est juste un cas particulier d'une recherche
    partielle qui matche tout. joinedload évite une requête supplémentaire
    par résultat pour charger la panne liée (fault).
    """
    recherche = (query or "").strip()
    if not recherche:
        # "   " passerait le min_length de la route : sans ce garde-fou, le
        # motif "%%" renverrait TOUTE la table.
        return []

    # % et _ sont des jokers pour ILIKE : on les échappe pour qu'une saisie
    # comme "E_4" cherche littéralement "E_4" et non "E" + n'importe quel caractère + "4".
    echappe = recherche.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    motif = f"%{echappe}%"
    trace("SEARCH", "Recherche SQL de codes d'erreur démarrée", strategy="sql_ilike")
    return (
        db.query(ErrorCode)
        .options(joinedload(ErrorCode.fault))
        .filter(ErrorCode.code.ilike(motif, escape="\\"))
        .order_by(ErrorCode.code)
        .all()
    )