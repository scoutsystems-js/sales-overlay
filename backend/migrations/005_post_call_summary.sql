-- Migration 005: post-call summary storage for v1.1.0 Feature 5
--
-- Adds one column to call_sessions:
--   post_call_summary TEXT  — AI-generated qualitative summary
--                             produced at session end. Captured
--                             from CallMemory state (rolling
--                             summary + keyFacts + discovery +
--                             detectedStage) before stop-session
--                             tears the engine down, sent through
--                             /proxy/post-call-summary, and
--                             rendered on the overlay before the
--                             user marks Win / Loss / Follow-up.
--
-- The outcome column already exists from migration 002 (v1.0.5
-- cloud logging) — this migration only adds the summary text.
-- The new PATCH /log/session-summary/:id route updates both
-- columns in one statement once the user picks an outcome.
--
-- No new RLS policies needed: existing call_sessions policies
-- (migration 003 'sessions_select_scoped') already cover reads;
-- writes go through the backend service role and are scoped by
-- user_id in the WHERE clause of each route.
--
-- Additive only. Safe to re-run.

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS post_call_summary TEXT;
