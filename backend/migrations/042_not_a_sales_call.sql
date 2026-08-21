-- 042 — "not a sales call" marking (Justin's ruling 2026-08-20).
--
-- A CLOSER (on their own call) or a MANAGER (on any call in their team) can mark
-- a call as not-a-sales-call so it stops counting. Josh's Zoom account
-- auto-records every meeting into his Personal Meeting Room, so private and
-- internal calls land in the corpus and are graded as if they were sales calls.
-- One of them created a real prospect named after two colleagues, which now sits
-- in the close-rate DENOMINATOR.
--
-- ⚠⚠ THIS MIGRATION IS DELIBERATELY INERT. It adds a nullable column that
-- nothing reads yet. Applying it changes no number on any screen. That is the
-- point: the danger in this change is CONSUMERS HALF-UPDATED, not the column
-- existing, so the column can land early and safely while the ~20 consumers are
-- done together.
--
-- ⚠ A MARKED CALL IS NOT HIDDEN AND NOT DELETED (architect ruling). It stays
-- visible in the call library, flagged, so it can be un-marked. Hiding it would
-- make the mark irreversible from the UI and would read as data loss.
--
-- ⚠ WHO marked it is recorded because EITHER ROLE MAY: a rep marking their own
-- call and a manager marking a rep's call are different acts, and the digest
-- entry for a reverse-toggle has to say which happened.

alter table public.fathom_calls
  add column if not exists not_a_sales_call     boolean,
  add column if not exists not_sales_marked_by  uuid references auth.users(id) on delete set null,
  add column if not exists not_sales_marked_at  timestamptz,
  add column if not exists not_sales_marked_role text;

-- ⚠ NULLABLE, NO DEFAULT — three states, not two, and the distinction is the
-- same one this project has paid for before (write-the-null):
--     NULL   never assessed        -> counts, and nobody has looked
--     false  assessed, IS a sales call -> counts, and someone confirmed it
--     true   assessed, NOT a sales call -> excluded
-- A `default false` would collapse "never assessed" into "confirmed sales call"
-- and make an un-mark indistinguishable from an untouched row.
comment on column public.fathom_calls.not_a_sales_call is
  'NULL = never assessed; false = confirmed a sales call (un-marked); true = excluded from all metrics. Set by the closer on their own call or a manager on a team call.';

alter table public.fathom_calls
  drop constraint if exists fathom_calls_not_sales_role_check;
alter table public.fathom_calls
  add constraint fathom_calls_not_sales_role_check
  check (not_sales_marked_role is null or not_sales_marked_role in ('closer','manager'));

-- ⚠ PARTIAL INDEX. Every metric query gains `not_a_sales_call is not true`, which
-- is true for the overwhelming majority of rows; indexing only the marked ones
-- keeps the index tiny while still letting the planner find them for the call
-- library's flag and for the un-mark path.
create index if not exists idx_fathom_calls_not_a_sales_call
  on public.fathom_calls (user_id, call_date)
  where not_a_sales_call is true;

-- ⚠⚠ THE PREDICATE IS `is not true`, NEVER `= false` OR `<> true`.
-- In Postgres, `not_a_sales_call = false` is NULL for an unassessed row and NULL
-- is not true, so the row would be EXCLUDED — silently dropping every call
-- nobody has looked at, which is almost all of them. This project has already
-- shipped two silent-null bugs of exactly this shape (the `.neq()` outdated
-- count, and the `.or()` prompt_version filter). Every consumer must use
-- `is not true` and the tests pin it.
