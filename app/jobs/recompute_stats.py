"""Entry point to rebuild the statistics table from the current DB state.

Script autonome pour recalculer la table de statistiques.

Ce fichier s'exécute en ligne de commande ou via une tâche planifiée (ex: CRON à 2h du matin) :
- Se connecte silencieusement à la BDD via SessionLocal().
- Lit toutes les interventions enregistrées pour recalculer et mettre à jour la table de stats.
- Évite de ralentir l'application web en déportant les gros calculs hors des requêtes HTTP.
- Affiche le nombre de lignes mises à jour et ferme proprement la connexion BDD.
"""
from app.core.database import SessionLocal
from app.services.stats_service import recompute_stats


def main() -> None:
    db = SessionLocal()
    try:
        count = recompute_stats(db)
        print(f"Recomputed {count} rows in symptom_action_outcome_stats.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
