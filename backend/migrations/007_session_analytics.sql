-- Migration 007: dashboard analytics for /dashboard (v1.1.10 prep)
--
-- Two additions, both for the closer analytics dashboard at /dashboard:
--
--   1) call_sessions.outcome_source TEXT
--      Provenance flag on the existing outcome column. 'inferred' means
--      Claude derived it from the post-call summary at session-end;
--      'manual' means the closer set or confirmed it from /dashboard.
--      Null when outcome itself is null (mid-call sessions, or sessions
--      created before this migration). Lets the dashboard show a
--      "verify this auto-marked outcome" badge and lets us measure
--      inference accuracy over time (compare inferred vs subsequent
--      manual overrides).
--
--      Existing outcome column from migration 002 is unchanged — still
--      'win' | 'loss' | 'follow_up' | null, still no DB-level CHECK
--      constraint (validation happens in backend routes).
--
--   2) public.session_objections (new table)
--      One row per objection event the local detector fired during a
--      call. Populated by a fire-and-forget extraction job at
--      session-end that mines session_logs for
--      '[claude] Local objection match: <label>' entries. Each row
--      gets a Claude classification of whether the objection was
--      overcome based on the ±90s of transcript around it.
--
--      UNIQUE (session_id, objection_id, detected_at) prevents
--      double-insertion if the extraction job runs twice for the same
--      session (idempotent re-runs).
--
--      RLS scoped policy mirrors call_sessions (own / admin-managed
--      via managed_by / owner sees all) — uses the existing
--      current_user_role() helper from migration 003.
--
-- Additive only. Safe to re-run.

-- ─── 1) Outcome provenance flag ─────────────────────────────────────────────
ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS outcome_source TEXT;

ALTER TABLE public.call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_outcome_source_check;

ALTER TABLE public.call_sessions
  ADD CONSTRAINT call_sessions_outcome_source_check
  CHECK (outcome_source IS NULL OR outcome_source IN ('inferred', 'manual'));

-- ─── 2) session_objections table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_objections (
  id                  bigserial   PRIMARY KEY,
  session_id          uuid        NOT NULL REFERENCES public.call_sessions(session_id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  detected_at         timestamptz NOT NULL,
  objection_id        text        NOT NULL,    -- 'money' | 'spouse' | 'think' | 'time' | 'tried-before' | 'send-info' | 'guarantee' | 'more-research' | 'not-right-time' | 'proof-it-works'
  objection_label     text        NOT NULL,    -- denormalized human label ('Money Objection') for display
  framework           text,                    -- 'money' | 'spouse' | 'think' | 'time' | null (secondary objections have null framework)
  overcome            boolean,                 -- null = uncertain, true = handled, false = not handled
  overcome_confidence text,                    -- 'high' | 'medium' | 'low' (only set when overcome is non-null)
  notes               text,                    -- short Claude rationale (~200 chars)
  CONSTRAINT session_objections_unique_event
    UNIQUE (session_id, objection_id, detected_at)
);

CREATE INDEX IF NOT EXISTS session_objections_session_idx
  ON public.session_objections (session_id);

CREATE INDEX IF NOT EXISTS session_objections_user_time_idx
  ON public.session_objections (user_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS session_objections_user_overcome_idx
  ON public.session_objections (user_id, overcome);

ALTER TABLE public.session_objections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_objections_select_scoped" ON public.session_objections;
CREATE POLICY "session_objections_select_scoped"
  ON public.session_objections FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'admin' AND user_id IN (
      SELECT user_id FROM public.user_profiles WHERE managed_by = auth.uid()
    ))
  );

-- Retention: session_objections cascade-deletes via FK when call_sessions
-- rows are removed by prune_old_session_data(). No separate cleanup needed.
