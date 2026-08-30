-- v30 — per-moment coaching on call_highlights.
--
-- WHY A COLUMN AND NOT A NEW TABLE: coaching is 1:1 with a moment, is rewritten
-- whenever the moment is re-extracted, and is read on the same query the panel
-- already runs. A side table would add a join to every read for no gain.
--
-- NULLABLE, and NULL is meaningful: it means this moment was never coached —
-- either it predates v30, or it is not a coachable type, or the pass failed.
-- A default of '' would make "not coached" and "coached to nothing" identical,
-- which is the write-the-null failure this project has already paid for twice.
--
-- ⚠ NEW CALLS ONLY. Nothing backfills; the standing ruling holds.

alter table public.call_highlights
  add column if not exists coaching text;

comment on column public.call_highlights.coaching is
  'v30 per-moment coaching text. NULL = never coached (pre-v30, non-coachable type, or the pass failed). Drives no score.';
