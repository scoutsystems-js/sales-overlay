-- 054: a third exclusion reason — the source that recorded the call is gone.
--
-- STILL ONE EXCLUSION FLAG. `not_a_sales_call` remains the only thing any
-- aggregate filters on; this column records WHY and drives the on-screen label
-- and nothing else. A second boolean would be ~21 more filters that can drift
-- out of step with the first, which is how two exclusions come to disagree.
--
-- WHY THIS REASON EXISTS. yazan's Zoom connection was removed after he moved to
-- Fathom, so 181 Zoom calls can never have their transcript fetched again —
-- there is no connection to fetch it with. They are not "waiting to be graded";
-- they are impossible to grade, and until now they were indistinguishable from
-- a backlog. That ambiguity sized an approved spend run at 616 calls when ~63
-- were gradeable.
--
-- NOT A DELETE. The rows stay, visible and labelled, and un-marking is a single
-- human action exactly as it is for the other reasons.
do $$
begin
  alter table public.fathom_calls drop constraint if exists fathom_calls_exclusion_reason_check;
  alter table public.fathom_calls
    add constraint fathom_calls_exclusion_reason_check
    check (exclusion_reason is null
           or exclusion_reason in ('compromised_file', 'source_disconnected'));
end $$;

comment on column public.fathom_calls.exclusion_reason is
  'Why this call is excluded. NULL = a person marked it not-a-sales-call (the '
  'original and still the default meaning). ''compromised_file'' = one distinct '
  'speaker across a substantial transcript, so it was never graded. '
  '''source_disconnected'' = the provider connection that recorded it no longer '
  'exists, so its transcript can never be fetched. Never aggregated on; drives '
  'the on-screen label only.';
