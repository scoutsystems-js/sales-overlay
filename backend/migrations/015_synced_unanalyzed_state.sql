-- Migration 015: 'synced_unanalyzed' holdable state
--
-- A synced call that is intentionally held back from analysis (cost-controlled
-- selective analysis — e.g. "only analyze the 20 most recent"). Distinct from
-- 'pending' (queued for analysis) so the reanalyze route (which picks up
-- sync_status='pending') skips it. Re-queue anytime by flipping back to 'pending'.
-- Added to both tables so the two stay in sync (mirror, non-destructive).
ALTER TABLE public.fathom_calls DROP CONSTRAINT IF EXISTS fathom_calls_sync_status_check;
ALTER TABLE public.fathom_calls ADD CONSTRAINT fathom_calls_sync_status_check
  CHECK (sync_status = ANY (ARRAY['pending','processed','error','synced_unanalyzed']));

ALTER TABLE public.call_analyses DROP CONSTRAINT IF EXISTS call_analyses_status_check;
ALTER TABLE public.call_analyses ADD CONSTRAINT call_analyses_status_check
  CHECK (status = ANY (ARRAY['pending','processing','done','error','synced_unanalyzed']));
