-- Stored scheduling facts only. Team coaching policy is applied at read time.
ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS manager_followup_facts jsonb;
COMMENT ON COLUMN public.call_analyses.manager_followup_facts IS
  'Full-transcript scheduling assessment with source hash and located evidence; NULL means not assessed. No outcome or grade changes.';
