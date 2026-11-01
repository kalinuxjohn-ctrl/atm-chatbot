-- ============================================================================
-- Migration 0018 — main_app : journal des appels vocaux
-- ============================================================================
-- Appels audio 1 contre 1, en WebRTC pair-à-pair : la voix ne passe JAMAIS
-- par le serveur et n'est jamais enregistrée. Le serveur ne fait que la
-- signalisation (sonnerie, décroché, raccroché) et garde ce journal.
--
-- Une ligne est écrite quand l'appel se termine :
--   missed    pas de réponse en 30 s, ou l'appelant a raccroché avant
--   answered  décroché (ended_at - answered_at = durée de la conversation)
--   declined  refusé par l'appelé
--   failed    occupé, appelé hors ligne, connexion perdue... (voir end_reason)
-- ============================================================================
BEGIN;

DO $$ BEGIN
    CREATE TYPE main_app.call_status AS ENUM ('missed', 'answered', 'declined', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS main_app.call_logs (
    id                     UUID PRIMARY KEY,
    caller_technician_id   INTEGER NOT NULL REFERENCES public.technician(technician_id) ON DELETE CASCADE,
    callee_technician_id   INTEGER NOT NULL REFERENCES public.technician(technician_id) ON DELETE CASCADE,
    status                 main_app.call_status NOT NULL,
    -- Détail technique de la fin : busy, callee_offline, no_answer, hung_up, connection_lost...
    end_reason             TEXT NOT NULL CHECK (end_reason ~ '^[a-z_]{1,40}$'),
    started_at             TIMESTAMPTZ NOT NULL,
    answered_at            TIMESTAMPTZ,
    ended_at               TIMESTAMPTZ NOT NULL,

    CONSTRAINT call_logs_distinct_participants CHECK (caller_technician_id <> callee_technician_id),
    CONSTRAINT call_logs_answered_has_time CHECK (status <> 'answered' OR answered_at IS NOT NULL),
    CONSTRAINT call_logs_chronology CHECK (ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_main_app_call_logs_caller ON main_app.call_logs(caller_technician_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_main_app_call_logs_callee ON main_app.call_logs(callee_technician_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON main_app.call_logs TO main_app_user;

COMMIT;
