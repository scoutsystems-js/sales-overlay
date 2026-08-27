-- 050 · Record WHY a highlight extraction produced nothing.
--
-- ⚠⚠ THE GAP THIS CLOSES. A highlight failure is NON-FATAL by design — the
-- grades still ship — so the only trace it left was a console.warn with no
-- reason and no snippet, in a log that does not survive a restart. The result
-- was a perfectly normal graded call with an empty highlight list and NOTHING
-- anywhere saying what happened.
--
-- That is what made the Zoom long-call defect undiagnosable for days: 7 of 9
-- long Zoom calls had zero highlights and the mechanism could not be recovered
-- from stored data at all. The cause turned out to be the raw-control-character
-- JSON defect (fixed in f4d3832), but nothing in the database could have said
-- so — it had to be inferred from a version/source cross-tab.
--
-- ⚠ WRITE-THE-NULL APPLIES. An absent reason and "evaluated, nothing wrong"
-- are opposite meanings and identical to a query, so this column is written on
-- EVERY analysis that reaches the highlight step: NULL means the extraction
-- succeeded, a string means it did not and says why. A row that never reached
-- the step keeps NULL too — distinguished by status, which is already stored.
alter table public.call_analyses
  add column if not exists highlight_error text;

comment on column public.call_analyses.highlight_error is
  'Why the highlight extraction produced no moments. NULL = it succeeded. Non-fatal: the grades still ship.';
