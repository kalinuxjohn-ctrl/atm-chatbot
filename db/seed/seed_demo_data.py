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
from app.services.embeddings_service import generate_embeddings_batch


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

# Réponses enregistrées des menus de suggestions du Copilote (migration 0011),
# lues telles quelles par /api/error_code et /api/usual_problem -- ni LLM, ni
# embedding. Une ligne = un paragraphe affiché dans le chat. Ce sont des
# EXEMPLES de démo : à relire et adapter avec les procédures réelles.
# Requêtes paramétrées (voir run_seed) : les apostrophes du texte n'ont pas
# à être échappées à la main.
ERROR_CODE_REPLIES = [
    (1, "gab", [
        "Code E42 : le capteur de rétention de carte ne répond pas (panne P001 – lecteur de carte bloqué).",
        "1. Mettez le GAB hors service et récupérez la carte retenue si elle est encore dans le lecteur.",
        "2. Vérifiez que le connecteur du capteur de rétention est bien branché sur la carte du lecteur.",
        "3. Nettoyez le capteur (poussière, débris de carte) puis redémarrez le lecteur.",
        "4. Si E42 réapparaît, remplacez le capteur de rétention.",
        "Si le problème persiste, décrivez-moi ce que vous observez pour chercher des interventions similaires.",
    ]),
    (2, "gab", [
        "Code E43 : le moteur du lecteur de carte est bloqué (panne P001 – lecteur de carte bloqué).",
        "1. Mettez le GAB hors service puis ouvrez le module lecteur de carte.",
        "2. Retirez tout objet coincé dans le chemin de la carte (carte, ticket, corps étranger).",
        "3. Vérifiez que les rouleaux tournent librement à la main, puis réinitialisez le lecteur.",
        "4. Si le moteur reste bloqué, remplacez le module lecteur de carte.",
        "Si le problème persiste, décrivez-moi ce que vous observez pour chercher des interventions similaires.",
    ]),
    (3, "gab", [
        "Code E67 : bourrage détecté dans le distributeur de billets (panne P002 – distributeur de billets en défaut).",
        "1. Mettez le GAB hors service et ouvrez le coffre selon la procédure de sécurité.",
        "2. Retirez les billets coincés dans le chemin de transport et dans la zone de présentation.",
        "3. Contrôlez l'état des cassettes (billets froissés ou mal rangés) et remettez-les en place.",
        "4. Lancez un test de distribution avant de remettre le GAB en service.",
        "Si le problème persiste, décrivez-moi ce que vous observez pour chercher des interventions similaires.",
    ]),
]

_FOLLOW_UP = "Si le problème persiste, décrivez-moi ce que vous observez pour chercher des interventions similaires."

USUAL_PROBLEMS = [
    # (usual_problem_id, device_type, display_order, label, paragraphes de la réponse)
    (1, "gab", 1, "Le GAB a avalé la carte du client", [
        "Carte avalée : le lecteur a retenu la carte (fin de délai, carte invalide ou défaut du lecteur).",
        "1. Mettez le GAB hors service et récupérez la carte dans le bac de rétention.",
        "2. Consultez le journal du GAB pour connaître le motif de rétention.",
        "3. Nettoyez la tête de lecture et le chemin de la carte, puis faites une transaction de test.",
        _FOLLOW_UP,
    ]),
    (2, "gab", 2, "Écran noir au démarrage du GAB", [
        "Écran noir au démarrage : l'écran n'est pas alimenté, ou le PC du GAB ne démarre pas.",
        "1. Vérifiez l'alimentation secteur et l'état des disjoncteurs du GAB.",
        "2. Contrôlez les câbles d'alimentation et vidéo de l'écran.",
        "3. Écoutez si le PC démarre (ventilateurs, voyants) : sinon, redémarrez-le électriquement.",
        _FOLLOW_UP,
    ]),
    (3, "gab", 3, "Billets bloqués dans le distributeur", [
        "Billets bloqués : bourrage dans le chemin de transport ou la zone de présentation.",
        "1. Mettez le GAB hors service et ouvrez le coffre selon la procédure de sécurité.",
        "2. Retirez les billets coincés et contrôlez l'état des cassettes.",
        "3. Lancez un test de distribution avant de remettre le GAB en service.",
        _FOLLOW_UP,
    ]),
    (4, "gab", 4, "L'imprimante de tickets ne fonctionne plus", [
        "Imprimante de tickets en panne : rouleau vide, bourrage ou tête d'impression encrassée.",
        "1. Vérifiez le rouleau de papier et son sens de mise en place.",
        "2. Retirez tout morceau de papier coincé, puis nettoyez la tête d'impression.",
        "3. Lancez une impression de test depuis le menu de maintenance.",
        _FOLLOW_UP,
    ]),
    (5, "gab", 5, "Le GAB est hors service", [
        "GAB hors service : un module est en défaut, ou la liaison avec le serveur est coupée.",
        "1. Consultez le journal du GAB pour identifier le module en défaut.",
        "2. Vérifiez la connexion réseau (câble, voyants du routeur).",
        "3. Redémarrez le GAB, puis vérifiez qu'il repasse en service.",
        _FOLLOW_UP,
    ]),
    (6, "tpe", 1, "Le TPE ne lit pas la carte", [
        "Carte non lue : lecteur encrassé, carte abîmée ou mauvais mode de lecture.",
        "1. Essayez une autre carte, en puce puis en piste, pour isoler le problème.",
        "2. Nettoyez le lecteur de puce et la piste magnétique avec une carte de nettoyage.",
        "3. Redémarrez le TPE, puis refaites une transaction de test.",
        _FOLLOW_UP,
    ]),
    (7, "tpe", 2, "Paiement sans contact refusé", [
        "Sans contact refusé : fonction désactivée, plafond atteint ou antenne en défaut.",
        "1. Vérifiez que le sans contact est activé dans les paramètres du TPE.",
        "2. Faites un test avec une autre carte ou un téléphone.",
        "3. Si tout est refusé, effectuez un téléchargement des paramètres (TMS) puis redémarrez.",
        _FOLLOW_UP,
    ]),
    (8, "tpe", 3, "L'imprimante du TPE n'imprime plus", [
        "Imprimante du TPE muette : rouleau vide, mal inséré ou capot mal fermé.",
        "1. Vérifiez le rouleau : papier thermique, face sensible vers la tête d'impression.",
        "2. Refermez le capot jusqu'au clic, puis lancez un ticket de test.",
        "3. Nettoyez la tête d'impression si le ticket sort blanc ou pâle.",
        _FOLLOW_UP,
    ]),
    (9, "tpe", 4, "Le TPE ne se connecte pas au réseau", [
        "TPE sans réseau : liaison coupée (Ethernet, Wi-Fi, 4G) ou paramètres incorrects.",
        "1. Vérifiez le câble ou le signal (Wi-Fi, 4G) et l'état de la carte SIM le cas échéant.",
        "2. Lancez un test de connexion depuis le menu du TPE.",
        "3. Redémarrez le TPE et la box du commerçant, puis refaites le test.",
        _FOLLOW_UP,
    ]),
    (10, "tpe", 5, "L'écran du TPE est figé", [
        "Écran figé : le logiciel du TPE ne répond plus.",
        "1. Forcez le redémarrage du TPE (combinaison de touches du constructeur ou retrait de la batterie).",
        "2. Vérifiez le niveau de batterie et le socle de charge.",
        "3. Si le blocage revient, faites une mise à jour logicielle via le TMS.",
        _FOLLOW_UP,
    ]),
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
    "SELECT setval('usual_problem_usual_problem_id_seq', (SELECT MAX(usual_problem_id) FROM usual_problem));",
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
                # Ne remplit que les codes encore sans réponse : une réponse
                # modifiée depuis par un administrateur n'est pas écrasée.
                cursor.executemany(
                    "UPDATE error_code SET device_type = %s, reply = %s "
                    "WHERE error_code_id = %s AND reply IS NULL",
                    [(device_type, "\n".join(reply), error_code_id) for error_code_id, device_type, reply in ERROR_CODE_REPLIES],
                )
                cursor.executemany(
                    "INSERT INTO usual_problem (usual_problem_id, device_type, display_order, label, reply) "
                    "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (usual_problem_id) DO NOTHING",
                    [
                        (usual_problem_id, device_type, display_order, label, "\n".join(reply))
                        for usual_problem_id, device_type, display_order, label, reply in USUAL_PROBLEMS
                    ],
                )
                for statement in SEQUENCE_RESETS:
                    cursor.execute(statement)
                # Ce script tourne à chaque `docker compose up` : seuls les
                # symptômes SANS vecteur sont envoyés à Voyage. Base déjà
                # remplie = aucun appel réseau.
                cursor.execute(
                    "SELECT intervention_symptom_id FROM intervention_symptom "
                    "WHERE intervention_symptom_id = ANY(%s) AND embedding IS NULL",
                    ([intervention_symptom_id for intervention_symptom_id, _ in EMBEDDING_BACKFILL],),
                )
                sans_vecteur = {row[0] for row in cursor.fetchall()}
                a_vectoriser = [(isym_id, raw_text) for isym_id, raw_text in EMBEDDING_BACKFILL if isym_id in sans_vecteur]

                if a_vectoriser:
                    # UN SEUL appel réseau pour tous les textes -- indispensable
                    # sur le palier gratuit Voyage (3 requêtes/minute).
                    vecteurs = generate_embeddings_batch([raw_text for _, raw_text in a_vectoriser])
                    for (intervention_symptom_id, _), vecteur in zip(a_vectoriser, vecteurs):
                        cursor.execute(
                            "UPDATE intervention_symptom SET embedding = %s::vector "
                            "WHERE intervention_symptom_id = %s",
                            (str(vecteur), intervention_symptom_id),
                        )
                print(f"Embeddings de démo : {len(a_vectoriser)} calculé(s), {len(EMBEDDING_BACKFILL) - len(a_vectoriser)} déjà en base.")
        print(
            "Données de démonstration insérées avec succès "
            "(interventions 3001 et 3045, codes d'erreur E42/E43/E67, pannes fréquentes)."
        )
    finally:
        connection.close()


if __name__ == "__main__":
    run_seed()