-- Additive coaching-only review; no grades, outcomes, auth or RLS changes.
ALTER TABLE public.call_analyses ADD COLUMN IF NOT EXISTS rep_period_coaching jsonb;
