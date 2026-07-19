-- Migration 016: objection_synthesis_cache
--
-- Caches the grounded ISOLATE→REFRAME→OVERCOME coaching synthesis per
-- (user, date range, analysis_set_hash). The hash is derived from the set of
-- analyzed calls + their analyzed_at in the window, so the cache invalidates
-- automatically when the analyzed set changes (new re-analysis) without a TTL.
-- One Claude call per unique (user, range, set); cached thereafter.
CREATE TABLE IF NOT EXISTS public.objection_synthesis_cache (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_ts           timestamptz NOT NULL,
  to_ts             timestamptz NOT NULL,
  analysis_set_hash text NOT NULL,
  synthesis         jsonb NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, from_ts, to_ts, analysis_set_hash)
);

-- Service-role only (backend writes/reads); enable RLS with no policies so the
-- table is inaccessible to anon/authenticated clients directly (matches the
-- call_analyses / call_highlights pattern).
ALTER TABLE public.objection_synthesis_cache ENABLE ROW LEVEL SECURITY;
