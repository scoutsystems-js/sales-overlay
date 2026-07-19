-- Migration 014: prompt_version stamp + objection surface layer
--
-- prompt_version: stamps which analysis-prompt version produced a call_analyses
-- row. Bumped manually in analysis-worker.js (ANALYSIS_PROMPT_VERSION) whenever
-- the grader/extractor prompts change. This is the guard that would have made
-- Issue 1 obvious in one query — you can tell stale-prompt analyses from current
-- ones instead of inferring from analyzed_at vs commit timing.
ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS prompt_version text;

-- objection_surface: the SURFACE objection as the prospect actually framed it
-- (short free-text, e.g. "too expensive", "needs spouse", "bad timing"). Pairs
-- with objection_category (the underlying driver: fear/logistical/timing/partner)
-- to form the two-layer taxonomy. Only meaningful on type='objection' rows.
ALTER TABLE public.call_highlights
  ADD COLUMN IF NOT EXISTS objection_surface text;
