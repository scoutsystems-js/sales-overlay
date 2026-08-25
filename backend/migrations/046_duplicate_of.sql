-- 046_duplicate_of.sql — suppress a cross-provider duplicate WITHOUT destroying it.
--
-- ⚠⚠ THE PROBLEM. Josh has Fathom AND Zoom connected, and both ingest the same
-- meeting ~1 minute apart. Measured 2026-08-24: 6 real meetings, 10 rows, and
-- 23 duplicate Zoom rows across his account. Every per-call figure he reads —
-- call count, close rate, cash, objection counts — is inflated.
--
-- ⚠ THE EXISTING DEDUPE CANNOT SEE IT, and that is not a gap in the logic:
-- UNIQUE (user_id, fathom_call_id) holds each PROVIDER'S OWN id, so two
-- providers can never collide by construction. It is the wrong key for the
-- question.
--
-- ⚠⚠ AND `meeting_id` DOES NOT PAIR THEM EITHER. A Personal Meeting Room reuses
-- ONE id for every meeting it ever hosts — all ten of Josh's rows carry
-- 8924530025. Anything keyed on it would merge his entire history into one call.
--
-- SUPPRESS, NEVER DELETE (ruling): the preference between providers is expected
-- to FLIP — Justin wants Zoom to replace Fathom eventually — and a match can be
-- wrong. A deleted call is unrecoverable; a marked one is one UPDATE away from
-- coming back.
--
-- ⚠ ON DELETE SET NULL is deliberate: if the surviving call is ever deleted,
-- the duplicate un-suppresses and becomes the only record of that meeting,
-- which is the correct outcome rather than losing the meeting entirely.

alter table public.fathom_calls
  add column if not exists duplicate_of uuid
    references public.fathom_calls(id) on delete set null;

-- Partial: only the suppressed rows are ever looked up this way, and every
-- counting query filters `duplicate_of is null`, which this index serves.
create index if not exists fathom_calls_duplicate_of_idx
  on public.fathom_calls (duplicate_of) where duplicate_of is not null;

comment on column public.fathom_calls.duplicate_of is
  'Set when this row is a cross-provider duplicate of another call by the SAME user (both providers recorded one meeting). Points at the row that is KEPT. NULL = counts normally. Never delete a duplicate: the provider preference can flip and a match can be wrong.';
