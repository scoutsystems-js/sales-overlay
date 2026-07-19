-- Migration 012: Deal outcome + objection categorization (Task 3+4 foundation)
--
-- Outcome capture (adaptive-learning foundation): the section grader now infers
-- a per-call outcome as one JSON field (no extra Claude call). Stored here so the
-- Close Rate metric returns and, once ≥ enough tagged calls accrue, the pattern
-- extraction job can contrast closed vs lost. outcome_source distinguishes
-- 'inferred' (grader), 'manual' (closer override on the review page), 'crm' (v1.4).
ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS outcome text
    CHECK (outcome IS NULL OR outcome IN ('closed','follow_up','lost','no_show')),
  ADD COLUMN IF NOT EXISTS outcome_source text
    CHECK (outcome_source IS NULL OR outcome_source IN ('inferred','manual','crm')),
  ADD COLUMN IF NOT EXISTS outcome_set_at timestamptz;

-- Objection categorization: the highlight extractor now tags each objection
-- highlight with a category and whether it was handled. Category enum is FINAL:
-- fear / logistical / timing / partner (money-phrased objections map to fear
-- unless the transcript shows a genuine logistical payment constraint — encoded
-- in the prompt, not the DB). Only meaningful for rows where type='objection';
-- nullable everywhere else. Enables per-category × handled × outcome win-rates.
ALTER TABLE public.call_highlights
  ADD COLUMN IF NOT EXISTS objection_category text
    CHECK (objection_category IS NULL OR objection_category IN ('fear','logistical','timing','partner')),
  ADD COLUMN IF NOT EXISTS objection_handled boolean;

-- Supports outcome aggregation (Close Rate) filtered by user.
CREATE INDEX IF NOT EXISTS call_analyses_user_outcome_idx
  ON public.call_analyses (user_id, outcome);
