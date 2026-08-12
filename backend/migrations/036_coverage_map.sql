-- 036 — the per-call coverage map (7c).
--
-- coverage: for each of the rep's derived areas (lib/coaching-areas.js), whether
-- that ground was established ON THIS CALL, with the line that establishes it.
--   [{"area_key":"financial_qualification","covered":true,
--     "evidence":"I've got about fifteen thousand set aside",
--     "evidence_verified":true}]
--
-- prospect_context: 1-3 factual attributes the prospect stated about THEMSELVES,
-- each with the prospect's own words. This is the piece that turns
-- discovery_notes prose ("primary residence, ~15K cash, VA loan tool") into
-- something rankable — 7d ranks uncovered areas against these attributes to
-- answer "given what this prospect said, the question that mattered was Z".
--   [{"attribute":"runs a counseling practice",
--     "evidence":"I've had my own practice for about six years",
--     "evidence_verified":true}]
--
-- ⚠ evidence_verified is set at WRITE TIME by lib/quote-locate.js, exactly as
-- call_highlights.speaker_verified is. It is NOT the model's opinion of its own
-- quote. Measured before this shipped: under v13 wording only 17% of the
-- grader's evidence quotes could be reconstructed from the transcript at all,
-- so an unverified quote must never be displayed as the rep's or the prospect's
-- words. v14's verbatim contract lifted that to 89% in an A/B and 3/3 in
-- production, which is what made this field worth storing.
--
-- ⚠ DRIVES NOTHING. No score, no grade, no surface. Same discipline that made
-- qualification_covered safe: it is measured and read before it is wired to
-- anything. And per KB ruling 1 it must NEVER reach SELLING CONTEXT — a rubric
-- the grader can read is a rubric the grader will excuse itself against.
--
-- Both nullable with no default: NULL means "this analysis predates 7c", which
-- must stay distinguishable from "assessed, and the ground was not covered".

alter table public.call_analyses
  add column if not exists coverage jsonb,
  add column if not exists prospect_context jsonb;

comment on column public.call_analyses.coverage is
  'Per-area coverage map [{area_key, covered, evidence, evidence_verified}]. evidence_verified is set at write time by quote-locate, not by the model. NULL = predates 7c. Coaching output only — never selling context.';

comment on column public.call_analyses.prospect_context is
  'Factual attributes the prospect stated about themselves [{attribute, evidence, evidence_verified}], max 3. Feeds 7d ranking. NULL = predates 7c.';
