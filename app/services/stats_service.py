"""Helpers to rebuild the symptom/action statistics table."""

from __future__ import annotations

from sqlalchemy import text


def recompute_stats(db) -> int:
    """Rebuild the aggregate stats used for case ranking."""
    db.execute(
        text(
            """
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
            JOIN intervention iv ON iv.intervention_id = ia.intervention_id
            JOIN device d ON d.device_id = iv.device_id
            GROUP BY isym.symptom_id, ia.action_id, d.device_type;
            """
        )
    )
    db.commit()
    row_count = db.execute(text("SELECT COUNT(*) FROM symptom_action_outcome_stats")).scalar()
    return int(row_count or 0)