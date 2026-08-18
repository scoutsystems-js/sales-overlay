-- 039 — item (j): when the closer stated the price.
--
-- Deterministic, computed in the worker from transcript_stored + the seller's
-- own user_profiles.price_pif. NO model call, so this is backfillable over
-- existing transcripts rather than new-calls-only.
--
-- NULLABLE, and null is EXPECTED: ~1 in 5 closed calls has no price moment at
-- all (measured by hand — a closed call whose own pitch_notes read "No pitch
-- occurred" is a second conversation on a deal already agreed). Any surface
-- over this column must exclude nulls and say how many.
alter table public.call_analyses
  add column if not exists price_stated_at_seconds integer,
  add column if not exists price_quote text;

comment on column public.call_analyses.price_stated_at_seconds is
  'Seconds into the call when the CLOSER first stated the seller''s own price_pif framed as the total. NULL when no such moment exists (expected on ~20% of closed calls) or when the seller has no stored price.';
