-- THE CLASSIFIER (Justin's ruling 2026-09-03, H708): three-state — sales · not_sales ·
-- unsure — a FIELD on the grader's output, not a third read. Every verdict carries its
-- reason, written BEFORE the verdict. Stored beside the call for review only: NOTHING
-- auto-marks a call until Justin has seen the blind score and ruled the threshold; a
-- human mark always wins.
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS sales_call_verdict text CHECK (sales_call_verdict IS NULL OR sales_call_verdict IN ('sales','not_sales','unsure'));
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS sales_call_reason_class text;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS sales_call_reason text;
COMMENT ON COLUMN call_analyses.sales_call_verdict IS 'The grader''s three-state call-kind verdict (v38+): sales | not_sales | unsure. Review only — never applied to fathom_calls without a ruled threshold.';
-- The blind harness: one row per run per call, labels held aside at draw time and
-- compared only after every verdict is written. Accumulates; never overwritten.
CREATE TABLE IF NOT EXISTS public.classifier_verdicts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          text NOT NULL,
  set_name        text NOT NULL CHECK (set_name IN ('tuning','held_out')),
  call_id         uuid NOT NULL REFERENCES public.fathom_calls(id) ON DELETE CASCADE,
  prompt_version  text NOT NULL,
  verdict         text CHECK (verdict IS NULL OR verdict IN ('sales','not_sales','unsure')),
  reason_class    text,
  reason          text,
  raw_error       text,
  ran_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS classifier_verdicts_run_idx ON public.classifier_verdicts (run_id, set_name);
