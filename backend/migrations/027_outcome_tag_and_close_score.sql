-- Migration 027: manual outcome tag + Close-section = 100 when closed
-- (Threads 1 & 2, 2026-07-27).
--
-- Thread 1: the outcome tag writes call_analyses.outcome (canonical, flows to
-- close rate / team analytics / needs-work / EOD). We already have outcome +
-- outcome_source ('inferred'|'manual'|'crm') + outcome_set_at (migration 012);
-- add outcome_set_by so an audit shows WHO tagged it.
--
-- Thread 2: any closed call scores 100 on the Close section. We store the
-- grader's originally EARNED close score in close_score_earned (never displayed)
-- so this is cheaply reversible / auditable without re-analysing history.

ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS outcome_set_by uuid,
  ADD COLUMN IF NOT EXISTS close_score_earned integer;

-- Backfill: preserve every row's earned close score, then set the displayed
-- close_score to 100 for calls that are (currently) closed. A later tag change
-- to/from 'closed' recomputes close_score from close_score_earned in the app.
UPDATE public.call_analyses
   SET close_score_earned = close_score
 WHERE close_score_earned IS NULL;

UPDATE public.call_analyses
   SET close_score = 100
 WHERE outcome = 'closed' AND status = 'done' AND close_score IS DISTINCT FROM 100;
