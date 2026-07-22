-- Migration 022: grader v8 — payment structure + first-person EOD summary
--
-- Both columns analysis-owned (versioned with the prompt, rewritten on
-- re-analysis), same placement rationale as 021's cash_collected:
--
-- 1) call_analyses.payment_structure — how the closed deal was paid, extracted
--    from transaction evidence in the transcript. Closed calls only; the
--    worker forces 'none_stated' for every other outcome (server-side
--    coupling, not just prompt discipline).
--
-- 2) call_analyses.eod_summary — 2-4 sentence FIRST-PERSON summary written in
--    the closer's voice for the EOD report. Coaching surfaces keep reading
--    overall_summary (third-person, analytical) — the two voices serve
--    different consumers and must never merge. NULL = pre-v8 analysis; the
--    EOD view falls back to overall_summary until re-analysis.
--
-- 3) eod_edits CHECK gains 'payment_structure' — it is user-editable in the
--    EOD view (constrained choice, enforced in the route), and edits win over
--    analysis values like every other EOD field.

ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS payment_structure text NOT NULL DEFAULT 'none_stated'
    CHECK (payment_structure IN ('paid_in_full', 'payment_plan', 'bnpl', 'none_stated'));

ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS eod_summary text;

-- Extend the eod_edits field allowlist. The constraint was created inline in
-- 021 (auto-named eod_edits_field_check) — drop + re-add with the new set.
ALTER TABLE public.eod_edits DROP CONSTRAINT IF EXISTS eod_edits_field_check;
ALTER TABLE public.eod_edits
  ADD CONSTRAINT eod_edits_field_check
  CHECK (field IN ('prospect_name', 'outcome', 'cash_collected', 'summary', 'payment_structure'));
