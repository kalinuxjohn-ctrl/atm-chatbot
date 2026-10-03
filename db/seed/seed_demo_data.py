"""
Script de seed : insère le cas d'exemple du design doc (§4 "Worked example")
dans une base fraîchement migrée (migrations 0001 à 0007 déjà appliquées).

Contient deux interventions distinctes qui partagent des symptômes mais PAS
la même solution -- exactement le scénario que le schéma doit préserver :

- Intervention 3001 (technicien Alan) : 3 symptômes, 3 actions tentées dans
  l'ordre, seule la 3e (réinitialisation) résout le problème.
- Intervention 3045 (technicien Bob) : 2 des mêmes symptômes + 1 nouveau,
  résolue par le remplacement d'un capteur -- une solution différente,
  enregistrée séparément, sans rien écraser du cas d'Alan.

Contient aussi quelques codes d'erreur et pannes de démo (migration 0007) --
indépendants du catalogue symptôme/action, aucun embedding nécessaire pour
ces deux tables (recherche texte classique, voir error_code_service.py).

Les embeddings des 6 symptômes ci-dessus sont calculés et écrits en base à
la fin de ce script (voir EMBEDDING_BACKFILL) : sans ça, la recherche par
symptôme (retrieval_service.py) n'aurait aucune donnée de démo à comparer.

Usage :
    python -m db.seed.seed_demo_data
"""

import psycopg2

from app.core.config import settings
from app.services.embeddings_service import generate_embedding


# Chaque chaîne est un statement SQL indépendant. ON CONFLICT ... DO NOTHING
# rend le script rejouable sans erreur si on l'exécute plusieurs fois par
# erreur sur la même base.
SEED_STATEMENTS = [
    # --- Fabricant, modèle, machines ---
    """
    INSERT INTO manufacturer (manufacturer_id, name)
    VALUES (1, 'Diebold Nixdorf')
    ON CONFLICT (manufacturer_id) DO NOTHING;
    """,
    """
    INSERT INTO device_model (model_id, manufacturer_id, model_name)
    VALUES (10, 1, 'Opteva 720')
    ON CONFLICT (model_id) DO NOTHING;
    """,
    """
    INSERT INTO device (device_id, device_type, serial_number, model_id, site_name, status)
    VALUES (501, 'gab', 'ON-DN-88213', 10, 'Branch 14, Main St', 'active')
    ON CONFLICT (device_id) DO NOTHING;
    """,
    # Deuxième machine, différente, pour l'intervention de Bob.
    """
    INSERT INTO device (device_id, device_type, serial_number, model_id, site_name, status)
    VALUES (502, 'gab', 'ON-DN-88214', 10, 'Branch 22, Elm St', 'active')
    ON CONFLICT (device_id) DO NOTHING;
    """,

    # --- Techniciens ---
    """
    INSERT INTO technician (technician_id, full_name, employee_code)
    VALUES (7, 'Alan Moreau', 'T-0071')
    ON CONFLICT (technician_id) DO NOTHING;
    """,
    """
    INSERT INTO technician (technician_id, full_name, employee_code)
    VALUES (8, 'Bob Nguyen', 'T-0082')
    ON CONFLICT (technician_id) DO NOTHING;
    """,
        # --- Techniciens ---
    """
    INSERT INTO technician (technician_id, full_name, employee_code)
    VALUES (4, 'Technicien Test API', 'T-0004')
    ON CONFLICT (technician_id) DO NOTHING;
    """,
    """
    INSERT INTO technician (technician_id, full_name, employee_code)
    VALUES (7, 'Alan Moreau', 'T-0071')
    ON CONFLICT (technician_id) DO NOTHING;
    """,
    """
    INSERT INTO technician (technician_id, full_name, employee_code)
    VALUES (8, 'Bob Nguyen', 'T-0082')
    ON CONFLICT (technician_id) DO NOTHING;
    """,


    # --- Catalogue partagé : composant, symptômes, actions ---
    """
    INSERT INTO component (component_id, name)
    VALUES (1, 'Card reader')
    ON CONFLICT (component_id) DO NOTHING;
    """,
    """
    INSERT INTO symptom (symptom_id, canonical_text, component_id) VALUES
        (21, 'Carte retenue par le GAB', 1),
        (22, 'La transaction ne s''achève pas', NULL),
        (23, 'Les espèces ne sont pas distribuées', NULL),
        (24, 'Imprimante de reçus bloquée', NULL)
    ON CONFLICT (symptom_id) DO NOTHING;
    """,
    """
    INSERT INTO action (action_id, canonical_text, component_id) VALUES
        (41, 'Check card reader', 1),
        (42, 'Check card-retention mechanism', 1),
        (43, 'Reinitialize card reader', 1),
        (44, 'Replace card-retention sensor', 1)
    ON CONFLICT (action_id) DO NOTHING;
    """,

    # --- Codes d'erreur / pannes (migration 0007) -- référentiel
    # indépendant, recherche texte classique uniquement, aucun embedding.
    # Choisis pour correspondre au même scénario "lecteur de carte"
    # qu'Alan et Bob, par cohérence avec le reste de la démo. ---
    """
    INSERT INTO fault (fault_id, code, name) VALUES
        (1, 'P001', 'Lecteur de carte bloqué'),
        (2, 'P002', 'Distributeur de billets en défaut')
    ON CONFLICT (fault_id) DO NOTHING;
    """,
    """
    INSERT INTO error_code (error_code_id, code, description, fault_id) VALUES
        (1, 'E42', 'Capteur de rétention de carte ne répond pas', 1),
        (2, 'E43', 'Moteur du lecteur de carte bloqué', 1),
        (3, 'E67', 'Distributeur de billets : bourrage détecté', 2)
    ON CONFLICT (error_code_id) DO NOTHING;
    """,

    # --- Intervention d'Alan (3001) : résolue par réinitialisation ---
    """
    INSERT INTO intervention (intervention_id, device_id, technician_id, opened_at, final_outcome_status)
    VALUES (3001, 501, 7, '2026-09-02 09:14', 'resolved')
    ON CONFLICT (intervention_id) DO NOTHING;
    """,
    """
    INSERT INTO intervention_symptom (intervention_symptom_id, intervention_id, symptom_id, raw_text) VALUES
        (9001, 3001, 21, 'La carte est retenue par le GAB.'),
        (9002, 3001, 22, 'La transaction ne s''achève pas.'),
        (9003, 3001, 23, 'Les espèces ne sont pas distribuées.')
    ON CONFLICT (intervention_symptom_id) DO NOTHING;
    """,
    """
    INSERT INTO intervention_action
        (intervention_action_id, intervention_id, action_id, raw_text, sequence_order,
         result_description, outcome_status, is_confirmed_solution)
    VALUES
        (7001, 3001, 41, 'Checked card reader for damage.', 1,
         'No physical damage found.', 'no_effect', FALSE),
        (7002, 3001, 42, 'Checked card-retention mechanism.', 2,
         'Mechanism operating within spec.', 'no_effect', FALSE),
        (7003, 3001, 43, 'Reinitialized card reader.', 3,
         'Reader reinitialized; card accepted and dispensed correctly on test transaction.',
         'resolved', TRUE)
    ON CONFLICT (intervention_action_id) DO NOTHING;
    """,
    """
    INSERT INTO diagnosis (diagnosis_id, intervention_id, description, root_cause_component_id, confirmed)
    VALUES (501, 3001, 'Card reader firmware/state got stuck; reinitialization cleared it.', 1, TRUE)
    ON CONFLICT (diagnosis_id) DO NOTHING;
    """,

    # --- Intervention de Bob (3045) : symptômes 21+22 en commun avec Alan,
    # PAS 23, plus un nouveau symptôme (24, imprimante bourrée). Solution
    # différente (remplacement d'un capteur, pas réinitialisation) --
    # enregistrée dans SA PROPRE intervention, rien n'est fusionné avec
    # le cas d'Alan : les deux restent interrogeables indépendamment. ---
    """
    INSERT INTO intervention (intervention_id, device_id, technician_id, opened_at, final_outcome_status)
    VALUES (3045, 502, 8, '2026-09-10 14:30', 'resolved')
    ON CONFLICT (intervention_id) DO NOTHING;
    """,
    """
    INSERT INTO intervention_symptom (intervention_symptom_id, intervention_id, symptom_id, raw_text) VALUES
        (9004, 3045, 21, 'La carte reste coincée dans le distributeur.'),
        (9005, 3045, 22, 'La transaction ne se termine jamais.'),
        (9006, 3045, 24, 'L''imprimante de reçus est bloquée.')
    ON CONFLICT (intervention_symptom_id) DO NOTHING;
    """,
    """
    INSERT INTO intervention_action
        (intervention_action_id, intervention_id, action_id, raw_text, sequence_order,
         result_description, outcome_status, is_confirmed_solution)
    VALUES
        (7004, 3045, 44, 'Replaced card-retention sensor.', 1,
         'Sensor replaced; card now ejects normally.', 'resolved', TRUE)
    ON CONFLICT (intervention_action_id) DO NOTHING;
    """,
]

# Après avoir inséré des lignes avec des ID choisis à la main, les séquences
# SERIAL de Postgres ne sont pas au courant du dernier ID utilisé. Sans ce
# correctif, le PROCHAIN insert "normal" (sans ID précisé, laissé à SERIAL)
# risquerait de retomber sur un ID déjà pris et de planter avec une violation
# de contrainte unique. On recale donc chaque séquence sur le MAX() réel.
SEQUENCE_RESETS = [
    "SELECT setval('manufacturer_manufacturer_id_seq', (SELECT MAX(manufacturer_id) FROM manufacturer));",
    "SELECT setval('device_model_model_id_seq', (SELECT MAX(model_id) FROM device_model));",
    "SELECT setval('device_device_id_seq', (SELECT MAX(device_id) FROM device));",
    "SELECT setval('technician_technician_id_seq', (SELECT MAX(technician_id) FROM technician));",
    "SELECT setval('component_component_id_seq', (SELECT MAX(component_id) FROM component));",
    "SELECT setval('symptom_symptom_id_seq', (SELECT MAX(symptom_id) FROM symptom));",
    "SELECT setval('action_action_id_seq', (SELECT MAX(action_id) FROM action));",
    "SELECT setval('fault_fault_id_seq', (SELECT MAX(fault_id) FROM fault));",
    "SELECT setval('error_code_error_code_id_seq', (SELECT MAX(error_code_id) FROM error_code));",
    "SELECT setval('intervention_intervention_id_seq', (SELECT MAX(intervention_id) FROM intervention));",
    "SELECT setval('intervention_symptom_intervention_symptom_id_seq', "
    "(SELECT MAX(intervention_symptom_id) FROM intervention_symptom));",
    "SELECT setval('intervention_action_intervention_action_id_seq', "
    "(SELECT MAX(intervention_action_id) FROM intervention_action));",
    "SELECT setval('diagnosis_diagnosis_id_seq', (SELECT MAX(diagnosis_id) FROM diagnosis));",
]

# Le seed insère les symptômes via du SQL brut (raw_text seulement) --
# l'embedding est calculé ici, en Python, puis écrit dans une passe séparée
# (voir run_seed) une fois les lignes en place. Le texte doit être identique
# mot pour mot à celui inséré plus haut dans SEED_STATEMENTS.
#
# fault/error_code n'apparaissent PAS ici : ces deux tables n'ont pas de
# colonne embedding (migration 0007, recherche texte classique uniquement).
EMBEDDING_BACKFILL = [
    (9001, "La carte est retenue par le GAB."),
    (9002, "La transaction ne s'achève pas."),
    (9003, "Les espèces ne sont pas distribuées."),
    (9004, "La carte reste coincée dans le distributeur."),
    (9005, "La transaction ne se termine jamais."),
    (9006, "L'imprimante de reçus est bloquée."),
]


def _to_psycopg2_dsn(sqlalchemy_url: str) -> str:
    """
    "postgresql+psycopg2://..." est une convention SQLAlchemy pour choisir
    le driver -- psycopg2.connect() ne la comprend pas et la traite comme
    un DSN invalide (le "+psycopg2" cassant le parsing). Comme ce script
    utilise psycopg2 directement (pas SQLAlchemy), on retire ce suffixe
    avant de s'en servir.
    """
    return sqlalchemy_url.replace("postgresql+psycopg2://", "postgresql://", 1)


def run_seed() -> None:
    """Exécute tous les inserts de démonstration, puis recale les séquences."""
    connection = psycopg2.connect(_to_psycopg2_dsn(settings.database_url))
    try:
        with connection:  # commit automatique en sortie de bloc si aucune exception
            with connection.cursor() as cursor:
                for statement in SEED_STATEMENTS:
                    cursor.execute(statement)
                for statement in SEQUENCE_RESETS:
                    cursor.execute(statement)
                for intervention_symptom_id, raw_text in EMBEDDING_BACKFILL:
                    vecteur = generate_embedding(raw_text)
                    cursor.execute(
                        "UPDATE intervention_symptom SET embedding = %s::vector "
                        "WHERE intervention_symptom_id = %s",
                        (str(vecteur), intervention_symptom_id),
                    )
        print(
            "Données de démonstration insérées avec succès "
            "(interventions 3001 et 3045, codes d'erreur E42/E43/E67)."
        )
    finally:
        connection.close()


if __name__ == "__main__":
    run_seed()