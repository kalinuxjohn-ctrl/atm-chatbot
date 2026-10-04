"""Helpers to rebuild the symptom/action statistics table."""

from __future__ import annotations

from sqlalchemy import text

from app.core.tracing import trace


def recompute_stats(db) -> int:
    """Rebuild the aggregate stats used for case ranking."""
    db.execute(
        text(
            """
            -- Sérialise les recalculs concurrents (ex. deux actions
            -- enregistrées en même temps) : sans ce verrou, deux
            -- DELETE + INSERT entrelacés violeraient la clé primaire.
            -- Les lectures (SELECT) restent possibles pendant le recalcul.
            LOCK TABLE symptom_action_outcome_stats IN EXCLUSIVE MODE;

            DELETE FROM symptom_action_outcome_stats;

            -- On ajoute une jointure jusqu'à `device` (via `intervention`)
            -- pour connaître le device_type de la machine sur laquelle
            -- l'action a été tentée, et on l'inclut dans le GROUP BY : un
            -- (symptom_id, action_id) donne donc une ligne par type
            -- d'appareil, pas une ligne unique tous appareils confondus.
            INSERT INTO symptom_action_outcome_stats
                (symptom_id, action_id, device_type, attempts, successes, accuracy_score, last_computed_at)
            SELECT
                isym.symptom_id,
                ia.action_id,
                d.device_type,
                COUNT(*) AS attempts,
                SUM(CASE WHEN ia.is_confirmed_solution THEN 1 ELSE 0 END) AS successes,
                AVG(CASE WHEN ia.is_confirmed_solution THEN 1.0 ELSE 0.0 END) AS accuracy_score,
                NOW() AS last_computed_at
            FROM intervention_action ia
            JOIN intervention_symptom isym ON isym.intervention_id = ia.intervention_id
            AND (ia.targets_symptom_id IS NULL OR ia.targets_symptom_id = isym.intervention_symptom_id)
            JOIN intervention iv ON iv.intervention_id = ia.intervention_id
            JOIN device d ON d.device_id = iv.device_id
            -- Indispensable : symptom_id et action_id sont NOT NULL dans
            -- cette table (migration 0004). Une action pas encore rattachée
            -- au catalogue (action_id NULL -- exactement le cas d'une
            -- solution que le technicien vient d'ajouter lui-même) ferait
            -- planter l'INSERT entier sans ce filtre, cassant le calcul
            -- pour TOUTES les paires, pas seulement celle-ci.
            WHERE ia.action_id IS NOT NULL AND isym.symptom_id IS NOT NULL
            GROUP BY isym.symptom_id, ia.action_id, d.device_type;
            """
        )
    )
    db.commit()
    row_count = db.execute(text("SELECT COUNT(*) FROM symptom_action_outcome_stats")).scalar()
    return int(row_count or 0)


def recompute_stats_safely(db) -> bool:
    """
    Variante pour les routes HTTP : appelée APRÈS le commit de la donnée
    métier (action enregistrée, action cataloguée...), un échec du recalcul
    ne doit pas transformer une écriture réussie en erreur 500. Les stats
    seront de toute façon reconstruites au prochain recalcul (ou par
    app/jobs/recompute_stats.py).
    """
    try:
        recompute_stats(db)
        return True
    except Exception as error:
        db.rollback()
        trace("ERROR", "Échec du recalcul des statistiques (donnée métier conservée)", error_type=type(error).__name__)
        return False
