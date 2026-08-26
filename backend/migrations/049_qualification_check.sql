-- 049 — per-criterion qualification verdicts (Justin's ruling 2026-08-26).
--
-- THE GAP THIS CLOSES: call_analyses.qualification_covered already stored a
-- prospect's financial disclosure VERBATIM — on the Abu call, "My personal
-- credit score right now is about 60 or something like that." The rep's own
-- criteria ("640 or above credit score") already reach the grader through
-- SELLING CONTEXT. Both numbers were in front of the model and NOTHING
-- COMPARED THEM, because that field records whether the topic was COVERED,
-- never whether the prospect PASSED.
--
-- ⚠ ADDITIVE AND NULLABLE. qualification_covered is untouched and keeps its
-- meaning. Every existing row gets NULL, which reads as "never evaluated" —
-- distinct from an empty array, which means "evaluated, no criteria to check".
-- Writing the null is what keeps those two apart; see the write-the-null rule.
--
-- Shape: [{ criterion, covered, verdict, evidence, evidence_verified }]
--   verdict ∈ passed | failed | undetermined   (THREE states, never two —
--   "failed" and "could not tell" must never render the same, and a prospect
--   who never mentioned money is not a prospect who failed)
--
-- ⚠ NO CHECK CONSTRAINT ON THE JSON. The shape is enforced in
-- lib/qualification-check.js, which also verifies each quote against the
-- transcript. A CHECK here would be a second, weaker copy of that rule.

alter table public.call_analyses
  add column if not exists qualification_check jsonb;

comment on column public.call_analyses.qualification_check is
  'Per-criterion qualification verdicts: [{criterion, covered, verdict(passed|failed|undetermined), evidence, evidence_verified}]. NULL = never evaluated; [] = evaluated with no criteria on file. A passed/failed verdict is only ever stored when its quote reconstructs as the PROSPECT''s own words.';
