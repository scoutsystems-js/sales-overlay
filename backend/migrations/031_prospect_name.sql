-- Migration 031: call_analyses.prospect_name — WHO the call was with.
-- PROSPECT NAMES, sub-stage 3a.
--
-- ── Why ───────────────────────────────────────────────────────────────────
-- Until now no prospect-name column existed in the Fathom-era schema at all.
-- The EOD view computed a name at READ time from the meeting title
-- (routes/eod.js prospectNameFromTitle: last '|' segment), and every other
-- surface rendered fathom_calls.title raw.
--
-- Measured on 83 live analyzed calls, the title is the wrong source twice over:
--   • 13 titles have no pipe, so the meeting label was shown verbatim —
--     ELEVEN distinct real prospects all collapsed into one fake prospect
--     named "Impromptu Zoom Meeting" (one of them a CLOSED call).
--   • The title is the BOOKED name, not who attended. On the 56 calls whose
--     grader prose reliably names the prospect, 19 (34%) name someone the
--     title does not — e.g. title "Tasha Presberry" vs attendee "Jamie Ellis".
--
-- That makes per-prospect close rate (the next stage) impossible: the
-- denominator is corrupt.
--
-- ── Columns ───────────────────────────────────────────────────────────────
-- prospect_name             — the resolved name. NULLABLE ON PURPOSE: under the
--                             governing principle a WRONG name is worse than NO
--                             name, so an unresolvable call stores NULL and
--                             renders "Unknown prospect" rather than a guess.
-- prospect_name_source      — which source won: grader | diarized | title.
--                             NULL when unresolved. Stored so a later merge
--                             review can weight by provenance.
-- prospect_name_confidence  — 'high' | 'low'. 'low' covers: title-derived
--                             (booked name), a combined couple name, and any
--                             resolution that had to ASSUME which speaker was
--                             the closer (speaker_closer_name is NULL on all 83
--                             existing rows, so that assumption is the norm).
--
-- Per ruling 4, source and confidence are NOT surfaced in the UI in 3a. They
-- become visible in 3d's merge review, where they are actionable.
--
-- Additive only, no backfill here (3c backfills). Safe to re-run.

ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS prospect_name            text,
  ADD COLUMN IF NOT EXISTS prospect_name_source     text,
  ADD COLUMN IF NOT EXISTS prospect_name_confidence text;

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_prospect_name_source_check;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_prospect_name_source_check
  CHECK (prospect_name_source IS NULL
         OR prospect_name_source IN ('grader', 'diarized', 'title', 'manual'));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_prospect_name_confidence_check;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_prospect_name_confidence_check
  CHECK (prospect_name_confidence IS NULL
         OR prospect_name_confidence IN ('high', 'low'));

COMMENT ON COLUMN public.call_analyses.prospect_name IS
  'Resolved prospect name (lib/prospect-name.js). NULL means "could not determine" — deliberately preferred over a plausible-looking guess, which would silently fabricate a prospect identity that later merges and miscounts.';

-- 3d groups calls by prospect; this index supports that lookup and the
-- "all calls with this prospect" drill. Partial: unresolved rows are never
-- grouped on.
CREATE INDEX IF NOT EXISTS call_analyses_prospect_name_idx
  ON public.call_analyses (user_id, prospect_name)
  WHERE prospect_name IS NOT NULL;
