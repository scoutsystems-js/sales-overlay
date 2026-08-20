-- Migration 041: the numeric meeting id, for calendar matching.
--
-- ⚠ WHY THIS IS NOT THE UUID WE ALREADY STORE. fathom_calls.fathom_call_id
-- holds Zoom's INSTANCE uuid (one per occurrence). A calendar invite's join URL
-- carries the NUMERIC meeting id (one per meeting, REUSED across a recurring
-- series and across every use of a personal meeting room). They are different
-- identifiers and neither is derivable from the other, so an exact
-- event -> call join needs this column and cannot use the uuid.
--
-- ⚠⚠ THE KEY IS meeting_id + DATE, NEVER THE ID ALONE. Josh's own parked call is
-- "Josh's Personal Meeting Room" — the reuse case is live, not hypothetical, and
-- id-alone would collapse every meeting in that room into one.
--
-- Nullable by necessity: every existing row predates this and no backfill is
-- possible for Zoom (the numeric id is not derivable from a stored uuid).
-- Fathom rows CAN be backfilled — its meeting_url carries the id — but that is
-- a separate pass, not this migration.
ALTER TABLE public.fathom_calls
  ADD COLUMN IF NOT EXISTS meeting_id text;

-- the join is (user, meeting, day) — see the note above on reuse
CREATE INDEX IF NOT EXISTS fathom_calls_meeting_id_date_idx
  ON public.fathom_calls (user_id, meeting_id, call_date)
  WHERE meeting_id IS NOT NULL;
