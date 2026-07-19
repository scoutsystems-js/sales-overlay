-- Migration 017: synthesis_type on the synthesis cache
--
-- The objection_synthesis_cache table now holds two kinds of Claude synthesis:
--   'objections'  — the ISOLATE/REFRAME/OVERCOME per-category coaching
--   'performance' — the Performance Summary (WHAT'S WORKING / WHAT TO IMPROVE)
-- Both share the same (user, range, analysis_set_hash) shape + set-hash
-- invalidation, so we extend this table rather than add a parallel one. Kept the
-- objection_-prefixed name to avoid a rename that would briefly break the
-- deployed objection-synthesis cache mid-deploy — the synthesis_type column
-- disambiguates.
ALTER TABLE public.objection_synthesis_cache
  ADD COLUMN IF NOT EXISTS synthesis_type text NOT NULL DEFAULT 'objections';

-- Extend the uniqueness to include synthesis_type so a performance row and an
-- objections row for the same (user, range, hash) coexist.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'public.objection_synthesis_cache'::regclass AND contype = 'u' LIMIT 1;
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.objection_synthesis_cache DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;

ALTER TABLE public.objection_synthesis_cache
  ADD CONSTRAINT synthesis_cache_unique UNIQUE (user_id, synthesis_type, from_ts, to_ts, analysis_set_hash);
