-- Renommage uniquement : PostgreSQL conserve les lignes, OID, cles et droits.
-- Les colonnes, types, schemas, sequences et index gardent leurs noms.
-- Les noms deja francais (intervention, action, conversation, sessions,
-- conversations, messages) et la table technique schema_migrations restent.
BEGIN;

SET LOCAL lock_timeout = '15s';

ALTER TABLE public.technician RENAME TO technicien;
ALTER TABLE public.manufacturer RENAME TO fabricant;
ALTER TABLE public.device_model RENAME TO modele_appareil;
ALTER TABLE public.device_model_version RENAME TO version_modele_appareil;
ALTER TABLE public.device RENAME TO appareil;
ALTER TABLE public.component RENAME TO composant;
ALTER TABLE public.symptom RENAME TO symptome;
ALTER TABLE public.intervention_symptom RENAME TO symptome_intervention;
ALTER TABLE public.intervention_action RENAME TO action_intervention;
ALTER TABLE public.diagnosis RENAME TO diagnostic;
ALTER TABLE public.symptom_action_outcome_stats RENAME TO statistiques_resultats_symptome_action;
ALTER TABLE public.conversation_message RENAME TO message_conversation;
ALTER TABLE public.conversation_context RENAME TO contexte_conversation;
ALTER TABLE public.fault RENAME TO panne;
ALTER TABLE public.error_code RENAME TO code_erreur;
ALTER TABLE public.solution_proposal RENAME TO proposition_solution;
ALTER TABLE public.usual_problem RENAME TO panne_frequente;
ALTER TABLE public.intervention_add RENAME TO ajout_intervention;

ALTER TABLE main_app.accounts RENAME TO comptes;
ALTER TABLE main_app.login_throttles RENAME TO blocages_connexion;
ALTER TABLE main_app.map_points RENAME TO points_carte;
ALTER TABLE main_app.conversation_participants RENAME TO participants_conversation;
ALTER TABLE main_app.message_attachments RENAME TO pieces_jointes_message;
ALTER TABLE main_app.call_logs RENAME TO journal_appels;

COMMIT;
