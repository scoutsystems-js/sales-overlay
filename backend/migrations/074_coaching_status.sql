-- 074 — THE COACHING PASS LEAVES A MARK (H736, 2026-09-05).
--
-- Phase 7c (per-moment coaching) is fire-and-forget and, until now, left NO trace of its own outcome: a
-- pass that wrote nothing — killed with the process, skipped, or failed — left `coaching` NULL on every
-- moment, which the page renders exactly like "no coaching yet". Four calls graded since v30 carry
-- coachable moments and no coaching, two of them coached on a first grade and lost on a re-grade; nothing
-- could count them and nothing can retry them, because nothing recorded that they were owed.
--
-- `coaching_status` is written 'pending' BEFORE the pass is dispatched and overwritten with its result:
-- 'written:N' · 'skipped:<reason>' · 'failed:<message>'. A row still 'pending' after the analysis is done
-- is a pass that never finished — visible, countable, and retryable by a later sweep. Additive; safe to re-run.
ALTER TABLE public.call_analyses ADD COLUMN IF NOT EXISTS coaching_status text;
COMMENT ON COLUMN public.call_analyses.coaching_status IS 'H736: the coaching pass''s own outcome — pending | written:N | skipped:<reason> | failed:<message>. NULL = graded before the mark existed.';
