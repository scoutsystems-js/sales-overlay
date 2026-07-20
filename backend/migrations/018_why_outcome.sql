-- 018_why_outcome.sql
-- "Why this call closed / didn't close" — causal evidence on the call review page.
--
-- The section grader (prompt v4) now produces, for win-class (closed) and
-- loss-class (lost) calls, the single most decisive cause of the outcome
-- anchored to one transcript moment, plus the timestamp of the moment the
-- `one_thing` correction belonged to. For loss-class calls one_thing is the
-- direct antidote to why_outcome, so the two render as cause -> correction.
--
-- Design note: ONE why_outcome column (not separate why_closed / why_not_closed)
-- because a call is win XOR loss — the review page interprets the column by the
-- call's outcome. follow_up / no_show / null leave why_outcome NULL (section hidden).
-- Existing analyses (pre-v4) have all four columns NULL and degrade gracefully:
-- the review page falls back to standalone one_thing. No forced re-analysis —
-- pending + future calls populate these naturally.

alter table call_analyses
  add column if not exists why_outcome                 text,
  add column if not exists why_quote                   text,
  add column if not exists why_timestamp_seconds       integer,
  add column if not exists one_thing_timestamp_seconds integer;

comment on column call_analyses.why_outcome is
  'Primary cause of the outcome (loss: why it did not close; win: what won it). NULL for follow_up/no_show/unanalyzed. Grader v4+.';
comment on column call_analyses.why_quote is
  'Exact transcript words anchoring why_outcome (for the review-page quote).';
comment on column call_analyses.why_timestamp_seconds is
  'Second offset of the why_outcome moment, for the Fathom clip (?t=) link.';
comment on column call_analyses.one_thing_timestamp_seconds is
  'Second offset of the moment the one_thing correction belonged to (Fathom clip link). For loss-class this pairs with why_outcome as cause -> fix.';
