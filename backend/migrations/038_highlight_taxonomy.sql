-- 038 — split the overloaded "objection" type (Justin's ruling 2026-08-12).
--
-- THE PROBLEM: Scout was detecting the right moments and filing them under the
-- wrong names. On one real call, of three moments tagged `objection` only ONE
-- was an objection; and a genuinely excellent catch — "discloses large prior
-- financial losses from failed opportunities, signaling skepticism that could
-- resurface as a barrier at close" — was filed as `rapport_moment`. The
-- detection was right. The vocabulary was too small to hold it.
--
-- JUSTIN'S DEFINITION, which governs:
--   "a true objection only happens after you drop price and ask for the close."
--
--   objection    — NARROWED. Resistance AFTER price is on the table and the
--                  close has been asked for. Nothing earlier qualifies.
--   risk_signal  — NEW. Attitudinal doubt that could kill the deal later:
--                  prior losses, skepticism, distrust, early price anxiety.
--   barrier      — NEW. A concrete practical obstacle, not an attitude:
--                  financing shortfall, third-party approval, timing.
--
-- Unchanged: buying_signal, missed_opportunity, strong_moment, rapport_moment
-- (now genuine connection ONLY), disqualify_signal.
--
-- NEW CALLS ONLY. Existing rows keep the broad `objection` type, so any
-- period-scoped metric spans both vocabularies until the corpus turns over —
-- see the objection-handle-rate note in CLAUDE.md.
--
-- The old values stay permitted: this widens the CHECK, it does not migrate
-- data. Nothing is rewritten and no historical row changes meaning.

alter table public.call_highlights
  drop constraint if exists call_highlights_type_check;

alter table public.call_highlights
  add constraint call_highlights_type_check
  check (type = any (array[
    'buying_signal'::text,
    'objection'::text,
    'risk_signal'::text,
    'barrier'::text,
    'missed_opportunity'::text,
    'strong_moment'::text,
    'rapport_moment'::text,
    'disqualify_signal'::text
  ]));
