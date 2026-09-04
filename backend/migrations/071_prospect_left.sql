-- 071 — "the prospect left" gets its own moment type (Justin's ruling 2026-09-04, H725).
-- Six of the eight missed-signal pairs that failed a hand read ended on the prospect LEAVING
-- — a reschedule request, a hang-up after a confrontation, a withdrawal in two pieces — typed
-- `disqualify_signal` by the extractor. None was a disqualification. The discriminator already
-- exists: a stated REASON the offer does not apply is a disqualification; leaving without one is
-- leaving. NEW CALLS ONLY (v43): the 138 stored disqualification moments stay as they are.
-- No rate reads the moment type (the DQ outcome is manual-only), so no live number moves.
alter table call_highlights drop constraint if exists call_highlights_type_check;
alter table call_highlights add constraint call_highlights_type_check
  check (type = any (array[
    'buying_signal', 'objection', 'risk_signal', 'barrier', 'missed_opportunity',
    'strong_moment', 'rapport_moment', 'disqualify_signal', 'prospect_left'
  ]::text[]));
