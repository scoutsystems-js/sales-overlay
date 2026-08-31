-- 058 — stamp the identity that FETCHED each call.
--
-- ⚠⚠ THE NATHAN INCIDENT (2026-08-31). 41 of one closer's calls were ingested
-- into another closer's account. It was found because Justin happened to look:
-- `fathom_calls` records NOTHING about which Fathom identity pulled a row, so
-- no query anywhere could say "these calls do not belong to this user".
--
-- ⚠ THE BLOCKER WAS NEVER THE DELETION, IT WAS THE DETECTION. This column is
-- what makes the invariant expressible:
--
--     calls whose recorded_by <> the owner's current fathom_email  ==  0
--
-- ⚠ NULLABLE AND NEW-ROWS-ONLY, DELIBERATELY. No backfill: the value is not
-- recoverable for historical rows (Fathom's /meetings window has moved), and a
-- guessed stamp would be worse than an absent one — it would make the audit
-- report clean over rows it never actually checked. NULL means "ingested before
-- this shipped", which is a different fact from "recorded by someone else", and
-- the audit must keep them apart.
--
-- ⚠ THIS IS STEP 1 OF 3 AND THE OTHER TWO ARE NOT BUILT: the audit reads the
-- column; a repair path comes later and is an explicit, confirmed admin action.
-- ⚠⚠ DELETING CALLS ON DISCONNECT IS EXPLICITLY REJECTED — it is the destructive
-- behaviour the preserve-history ruling exists to prevent, and it would fire on
-- every ordinary disconnect to catch a rare mistake.

alter table public.fathom_calls
  add column if not exists recorded_by text;

comment on column public.fathom_calls.recorded_by is
  'The Fathom recorder identity this row was fetched under (recorded_by[] filter). '
  'NULL for rows ingested before migration 058 — absent, not mismatched. '
  'Invariant: for any owner, recorded_by should equal that user''s fathom_connections.fathom_email.';

-- partial index: the audit only ever asks about rows that HAVE a stamp
create index if not exists idx_fathom_calls_recorded_by
  on public.fathom_calls (user_id, recorded_by)
  where recorded_by is not null;
