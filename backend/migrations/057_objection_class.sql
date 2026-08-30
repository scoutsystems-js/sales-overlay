-- 057 — cache the strict/loose classification ON the moment (Justin's ruling 2026-08-30).
--
-- "Go the cached route for objections." Classify once at analysis time, store it,
-- every surface reads it: all six show the same number and nothing gets slower.
--
-- ⚠⚠ THE CHEAP PATH WAS CHECKED FIRST AND IT DOES NOT WORK. Scout already types
-- every moment (v17 split objection/risk_signal/barrier; v27/v35 route DQs to
-- disqualify_signal), so the obvious hope was that `type='objection'` already
-- means "true objection" and there is nothing to cache. Measured on 813 live
-- moments already typed `objection`, over 90 days:
--
--     true_objection      589
--     disqualification    129     ⚠ 195 of 813 = 24% are NOT true objections
--     logistical_barrier   66
--
-- ⚠ AND THE STORED CATEGORY CANNOT PREDICT IT: the disqualifications come from
-- objection_category fear 81, timing 21, logistical 21, partner 6. There is no
-- derivation from stored fields, so the classification is genuinely needed.
--
-- ⚠ NULLABLE, and NULL is meaningful: "graded before this shipped". Nothing
-- re-analyses, so the crossover is real and the readers fall back to counting
-- the moment (the loose behaviour that already exists). The population corrects
-- itself as calls turn over.

alter table public.call_highlights
  add column if not exists objection_class text;

alter table public.call_highlights
  drop constraint if exists call_highlights_objection_class_check;

alter table public.call_highlights
  add constraint call_highlights_objection_class_check
  check (objection_class is null
         or objection_class in ('true_objection', 'logistical_barrier', 'disqualification'));
