-- Arreter les applications avant ce retour aux noms de app-in-prod.
-- Ce fichier n'est jamais execute automatiquement par init-db.
BEGIN;
SET LOCAL lock_timeout = '15s';

ALTER TABLE main_app.journal_appels RENAME TO call_logs;
ALTER TABLE main_app.pieces_jointes_message RENAME TO message_attachments;
ALTER TABLE main_app.participants_conversation RENAME TO conversation_participants;
ALTER TABLE main_app.points_carte RENAME TO map_points;
ALTER TABLE main_app.blocages_connexion RENAME TO login_throttles;
ALTER TABLE main_app.comptes RENAME TO accounts;

ALTER TABLE public.ajout_intervention RENAME TO intervention_add;
ALTER TABLE public.panne_frequente RENAME TO usual_problem;
ALTER TABLE public.proposition_solution RENAME TO solution_proposal;
ALTER TABLE public.code_erreur RENAME TO error_code;
ALTER TABLE public.panne RENAME TO fault;
ALTER TABLE public.contexte_conversation RENAME TO conversation_context;
ALTER TABLE public.message_conversation RENAME TO conversation_message;
ALTER TABLE public.statistiques_resultats_symptome_action RENAME TO symptom_action_outcome_stats;
ALTER TABLE public.diagnostic RENAME TO diagnosis;
ALTER TABLE public.action_intervention RENAME TO intervention_action;
ALTER TABLE public.symptome_intervention RENAME TO intervention_symptom;
ALTER TABLE public.symptome RENAME TO symptom;
ALTER TABLE public.composant RENAME TO component;
ALTER TABLE public.appareil RENAME TO device;
ALTER TABLE public.version_modele_appareil RENAME TO device_model_version;
ALTER TABLE public.modele_appareil RENAME TO device_model;
ALTER TABLE public.fabricant RENAME TO manufacturer;
ALTER TABLE public.technicien RENAME TO technician;

DELETE FROM public.schema_migrations WHERE filename = '0019_table_names_french.sql';
COMMIT;
