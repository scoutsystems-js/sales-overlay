-- Migration 008: coaching narratives + prospect names (v1.1.11 prep)
--
-- The /coaching page renders narrative coaching feedback per objection event
-- ("On the call with X on Y, prospect said Z, you said W instead of [framework
-- rebuttal]. Try: [specific suggestion]"). To produce this we need to store
-- four new pieces of information that v1.1.10's session_objections didn't:
--
--   1) call_sessions.prospect_name TEXT
--      Claude-extracted from the call transcript (intro 5-10 min usually
--      has names). Null when not detectable. Backfill via batch route.
--      Used in the coaching narrative ("On the call with John on…").
--
--   2) session_objections.framework_rebuttal TEXT
--      Denormalized from src/ai/objections.js at extraction time. Stored
--      rather than mapped at render time so historical rows preserve what
--      Scout WOULD have suggested at that point in time — if the framework
--      copy changes later, old calls still show what was active then.
--
--   3) session_objections.closer_response TEXT
--      The closer's own words in the 30-60s after the objection fired.
--      Extracted from session_logs '[deepgram] Transcript (final) [CLOSER]:'
--      lines in that window. Up to ~600 chars; trimmed at write time.
--
--   4) session_objections.coaching_note TEXT
--      Claude-generated 2-3 sentence prescriptive coaching narrative
--      following the user-specified format: "On the call with [name] on
--      [date], the prospect [said X]. You [did Y] instead of [framework
--      response]. Try [specific rebuttal]." Distinct from the brief
--      'notes' field (which holds classifier reasoning); coaching_note is
--      user-facing copy rendered verbatim on the /coaching page.
--
-- Additive only. Safe to re-run.

-- ─── 1) Prospect name on the session ────────────────────────────────────────
ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS prospect_name TEXT;

-- ─── 2-4) Coaching fields on session_objections ─────────────────────────────
ALTER TABLE public.session_objections
  ADD COLUMN IF NOT EXISTS framework_rebuttal TEXT;

ALTER TABLE public.session_objections
  ADD COLUMN IF NOT EXISTS closer_response    TEXT;

ALTER TABLE public.session_objections
  ADD COLUMN IF NOT EXISTS coaching_note      TEXT;

-- No new policies needed — existing call_sessions / session_objections
-- SELECT policies (own / admin-managed / owner) cover these columns too.
