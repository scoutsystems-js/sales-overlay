-- Migration 021: EOD Report — grader-extracted cash + user edit overrides
--
-- Two pieces, one stage:
--
-- 1) call_analyses.cash_collected — the grader's v7 extraction of the payment
--    amount explicitly collected ON the call. Lives with analysis output
--    (NOT fathom_calls) because it is versioned with the prompt: a re-analysis
--    under a newer prompt legitimately rewrites it, exactly like every other
--    grader field. numeric(12,2), NOT NULL DEFAULT 0 — zero means "nothing
--    collected or nothing explicitly stated" (the prompt forbids inference).
--
-- 2) eod_edits — the user-edit layer for the EOD Report view. One row per
--    (user, call, field), value stored as text; render logic is
--    "override if present, else analysis value". Kept OUTSIDE call_analyses
--    so the analysis upsert can never touch it (the outcome_source
--    pattern-in-waiting, promoted to its own table): a re-analysis rewrites
--    analysis values but user edits always win at read time.
--    Row-per-field (not a jsonb blob per call) so each inline edit is one
--    atomic upsert — two fields edited concurrently can never clobber each
--    other via read-modify-write.

ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS cash_collected numeric(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.eod_edits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fathom_call_id uuid NOT NULL REFERENCES public.fathom_calls(id) ON DELETE CASCADE,
  field          text NOT NULL CHECK (field IN ('prospect_name', 'outcome', 'cash_collected', 'summary')),
  value          text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fathom_call_id, field)
);

-- Service-role only (backend enforces user scoping in the /eod routes) —
-- RLS enabled with no policies, matching call_analyses / call_highlights /
-- objection_synthesis_cache.
ALTER TABLE public.eod_edits ENABLE ROW LEVEL SECURITY;
