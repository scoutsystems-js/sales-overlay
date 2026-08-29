-- 052: why a call is excluded, so "compromised file" and "not a sales call"
-- can be told apart on screen WITHOUT a second exclusion path.
--
-- ONE EXCLUSION FLAG, TWO REASONS. `not_a_sales_call` stays the only thing any
-- aggregate filters on — it is already read in 21 places and pinned by
-- test/duplicate-exclusion-carrier.js. Adding a second boolean would mean 21
-- more filters that can drift out of step with the first, which is exactly how
-- two exclusions come to disagree. This column records WHY, and nothing
-- aggregates on it: it drives the label a human sees and nothing else.
--
-- NULL IS THE EXISTING MEANING, so there is no backfill. Every row excluded
-- before today was excluded by a person deciding it was not a sales call, and
-- NULL continues to mean exactly that.
alter table public.fathom_calls
  add column if not exists exclusion_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fathom_calls_exclusion_reason_check'
  ) then
    alter table public.fathom_calls
      add constraint fathom_calls_exclusion_reason_check
      check (exclusion_reason is null or exclusion_reason in ('compromised_file'));
  end if;
end $$;

-- Partial: only excluded rows carry a reason, and they are ~0.6% of the table.
create index if not exists fathom_calls_exclusion_reason_idx
  on public.fathom_calls (user_id, exclusion_reason)
  where exclusion_reason is not null;

comment on column public.fathom_calls.exclusion_reason is
  'Why this call is excluded. NULL = a person marked it not-a-sales-call (the '
  'original and still the default meaning). ''compromised_file'' = Scout '
  'detected one distinct speaker across a substantial transcript and refused '
  'to grade it. Never aggregated on; drives the on-screen label only.';
