-- 056 — a fifth OUTCOME value: 'disqualified'.
--
-- Justin's ruling 2026-08-30: "when a call is marked as DQ it should count in
-- calls analyzed but not obj handling % or closing %."
--
-- ⚠⚠ WHY AN OUTCOME AND NOT A SECOND EXCLUSION FLAG. `not_a_sales_call` already
-- exists and is filtered in ~25 places — but it is excluded from EVERYTHING,
-- INCLUDING calls-analyzed, which directly contradicts the ruling. Reusing it
-- would hide the call. A second boolean would be a SECOND EXCLUSION PATH, and
-- two ways to exclude a call is how they diverge. The outcome column already
-- exists, already renders in the dropdown the ruling names, and already carries
-- the outcome_source='manual' freeze that stops re-analysis clobbering a human
-- mark — so this is the cheap door, not a new one.
--
-- ⚠⚠ MANUAL-ONLY BY CONSTRUCTION, AND THAT IS A SAFETY PROPERTY, NOT A POLICY.
-- The GRADER has its own four-value list (lib/analysis-worker.js VALID_OUTCOMES)
-- which is deliberately NOT widened. If the model could infer 'disqualified' it
-- could silently remove a call from a rep's close rate and handle rate — a rep
-- marked down, or let off, by a model error nobody sees. A human states it.
--
-- Nullable and additive: every existing row keeps its value, nothing backfills.

alter table public.call_analyses
  drop constraint if exists call_analyses_outcome_check;

alter table public.call_analyses
  add constraint call_analyses_outcome_check
  check (outcome is null or outcome in ('closed', 'follow_up', 'lost', 'no_show', 'disqualified'));
