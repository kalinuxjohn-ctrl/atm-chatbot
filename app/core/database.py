"""
Connexion à la base de données Postgres et gestion des sessions SQLAlchemy.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

# echo=False en usage normal ; passer à True temporairement pour voir le
# SQL généré par l'ORM pendant le débogage.
engine = create_engine(settings.database_url, echo=False, future=True)

# Chaque requête HTTP obtient sa propre session (voir get_db ci-dessous),
# fermée automatiquement à la fin -- évite les fuites de connexions.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

# Toutes les classes ORM définies dans app/models/ hériteront de cette Base
# commune : c'est ce qui permet à SQLAlchemy de savoir quelles tables gérer.
Base = declarative_base()


def get_db():
    """
    Dépendance FastAPI : fournit une session DB à une route, puis la ferme
    proprement même si la route lève une exception en cours de route.

    Utilisation dans une route :
        @app.get("/interventions")
        def lister_interventions(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()