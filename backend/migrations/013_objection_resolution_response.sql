-- Migration 013: Objection resolution + closer's actual response (grounded coaching)
--
-- Task: coaching synthesis must be GROUNDED — when the closer's own calls contain
-- a successfully handled objection of a category, the "how to handle it next time"
-- advice cites that real moment (quote the closer's actual response + a Fathom
-- clip link). To support that, each type='objection' highlight now records:
--
--   resolution      — richer than the coarse objection_handled bool from mig 012:
--                      'handled'   = closer resolved it and advanced
--                      'partial'   = partially addressed / prospect still hesitant
--                      'unhandled' = left unresolved
--   closer_response — the closer's ACTUAL words handling the objection (verbatim
--                     slice), used as the grounding quote in synthesis. The
--                     Fathom clip link is derived at render time from the row's
--                     recording_url + timestamp_seconds (?t=seconds).
--
-- objection_handled (mig 012) is kept and set = (resolution='handled') for
-- back-compat. Both nullable; only meaningful on type='objection' rows.
ALTER TABLE public.call_highlights
  ADD COLUMN IF NOT EXISTS resolution text
    CHECK (resolution IS NULL OR resolution IN ('handled','partial','unhandled')),
  ADD COLUMN IF NOT EXISTS closer_response text;
