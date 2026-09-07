-- Generated with supabase migration new stage_eligibility (20260907003556),
-- renamed to the repository's existing migration sequence.
-- Additive field on the existing RLS-protected analysis row. No policy changes.
ALTER TABLE public.call_analyses ADD COLUMN IF NOT EXISTS stage_eligibility jsonb;
COMMENT ON COLUMN public.call_analyses.stage_eligibility IS
  'Source-supported stage eligibility and measured grades; NULL means legacy, not reviewed under the new stage rules.';
