-- Migration 010: Post-call analysis pipeline for Scout v2.0 Phase 2
--
-- Scout v2.0 Phase 2 turns each synced Fathom call into structured
-- coaching output. The analysis worker picks up fathom_calls rows where
-- sync_status='pending', fetches the transcript + highlights + summary
-- from Fathom, normalizes timestamps, identifies CLOSER vs PROSPECT, and
-- fires two parallel Claude calls (section grader + highlight extractor).
-- Their outputs land in the two tables this migration adds.
--
-- Pipeline:
--   fathom_calls.sync_status='pending'
--     → worker picks it up
--     → normalize timestamps + identify speakers
--     → 2 parallel Claude calls (section grader + highlight extractor)
--     → INSERT call_analyses row + INSERT call_highlights rows
--     → fathom_calls.sync_status='processed'
--
-- Two new tables, both scoped per user via auth.users(id) and per call
-- via fathom_calls(id):
--
--   public.call_analyses    — one row per analyzed call (UNIQUE
--                             fathom_call_id enforces this). Holds the
--                             overall summary + 5 section grades + the
--                             one-thing-to-do-differently + the
--                             follow-up-email draft + the normalized
--                             transcript so the analysis stays
--                             reproducible without re-fetching from
--                             Fathom. status tracks the analysis
--                             lifecycle within the row, separately from
--                             fathom_calls.sync_status.
--
--   public.call_highlights  — one row per highlight moment, typically
--                             5–8 per analyzed call. Each row carries
--                             a quoted exact line + a one-sentence
--                             observation + a moment type. sequence_order
--                             drives the timeline view on the dashboard
--                             review page; timestamp_seconds drives
--                             the Fathom ?t= deep link.
--
-- CHECK constraints lock down the controlled vocabularies the rest of
-- the system depends on:
--   - status:        'pending' | 'processing' | 'done' | 'error'
--   - overall_score, section_score: 0–100 inclusive (or NULL)
--   - section_grade: 'A' | 'B' | 'C' | 'D' | 'F' (or NULL — pre-analysis)
--   - highlight speaker: 'CLOSER' | 'PROSPECT'
--   - highlight type: buying_signal | objection | missed_opportunity |
--                     strong_moment | rapport_moment | disqualify_signal
--
-- RLS mirrors migration 009's fathom_calls pattern exactly (own /
-- admin-managed / owner via current_user_role()). Like the other
-- analytics tables, there are NO INSERT/UPDATE policies — the backend
-- writes via the service-role key, bypassing RLS by design. The
-- analysis worker is server-side; closers never write to these tables
-- directly.
--
-- Indexes:
--   call_analyses_user_status_idx     — for the worker scanning a user's
--                                       pending/error rows.
--   call_analyses_fathom_call_id_uniq — automatic from the UNIQUE
--                                       constraint on fathom_call_id;
--                                       provides the FK-join index for
--                                       free.
--   call_highlights_fathom_call_id_idx — for fetching all highlights of
--                                       one call (the dashboard timeline).
--   call_highlights_user_type_idx     — for cross-call queries like
--                                       "show me every buying_signal
--                                       I've ever surfaced" (powers the
--                                       v1.4.0 objection intelligence
--                                       dashboard later).
--
-- Additive only. Safe to re-run.

-- ─── 1) call_analyses ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_analyses (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fathom_call_id       uuid        NOT NULL REFERENCES public.fathom_calls(id) ON DELETE CASCADE,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Overall analysis
  overall_score        integer,                                 -- 0–100, null until done
  overall_summary      text,                                    -- null until done

  -- Five section grades (Intro / Discovery / Pitch / Objection Handling / Close).
  -- Each gets three columns: letter grade, numeric score, free-form notes with
  -- transcript-anchored evidence. All null pre-analysis; populated atomically
  -- when status flips to 'done'.
  intro_grade          text,
  intro_score          integer,
  intro_notes          text,

  discovery_grade      text,
  discovery_score      integer,
  discovery_notes      text,

  pitch_grade          text,
  pitch_score          integer,
  pitch_notes          text,

  objection_grade      text,
  objection_score      integer,
  objection_notes      text,

  close_grade          text,
  close_score          integer,
  close_notes          text,

  -- Coaching outputs
  one_thing            text,                                    -- single actionable for next call
  follow_up_email      text,                                    -- draft email body the closer can copy

  -- Reproducibility / review surface
  transcript_stored    jsonb,                                   -- normalized turn array [{ speaker, role, text, start_seconds }, ...]
  speaker_closer_name  text,                                    -- the display_name we identified as the closer in this transcript

  -- Lifecycle
  analyzed_at          timestamptz,                             -- timestamp when status flipped to 'done'
  status               text        NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'done' | 'error'

  CONSTRAINT call_analyses_unique_call UNIQUE (fathom_call_id)
);

-- Status enum
ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_status_check;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'error'));

-- Overall score range
ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_overall_score_range;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_overall_score_range
  CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100));

-- Per-section score range (5 constraints, one per section column for
-- explicit error messages — Postgres surfaces the constraint name on
-- violation, and a single combined constraint would hide which section
-- failed).
ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_intro_score_range;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_intro_score_range
  CHECK (intro_score IS NULL OR (intro_score >= 0 AND intro_score <= 100));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_discovery_score_range;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_discovery_score_range
  CHECK (discovery_score IS NULL OR (discovery_score >= 0 AND discovery_score <= 100));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_pitch_score_range;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_pitch_score_range
  CHECK (pitch_score IS NULL OR (pitch_score >= 0 AND pitch_score <= 100));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_objection_score_range;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_objection_score_range
  CHECK (objection_score IS NULL OR (objection_score >= 0 AND objection_score <= 100));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_close_score_range;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_close_score_range
  CHECK (close_score IS NULL OR (close_score >= 0 AND close_score <= 100));

-- Per-section letter grade enum (5 constraints — same reasoning as scores).
ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_intro_grade_check;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_intro_grade_check
  CHECK (intro_grade IS NULL OR intro_grade IN ('A', 'B', 'C', 'D', 'F'));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_discovery_grade_check;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_discovery_grade_check
  CHECK (discovery_grade IS NULL OR discovery_grade IN ('A', 'B', 'C', 'D', 'F'));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_pitch_grade_check;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_pitch_grade_check
  CHECK (pitch_grade IS NULL OR pitch_grade IN ('A', 'B', 'C', 'D', 'F'));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_objection_grade_check;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_objection_grade_check
  CHECK (objection_grade IS NULL OR objection_grade IN ('A', 'B', 'C', 'D', 'F'));

ALTER TABLE public.call_analyses
  DROP CONSTRAINT IF EXISTS call_analyses_close_grade_check;
ALTER TABLE public.call_analyses
  ADD CONSTRAINT call_analyses_close_grade_check
  CHECK (close_grade IS NULL OR close_grade IN ('A', 'B', 'C', 'D', 'F'));

-- ─── 2) call_highlights ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_highlights (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fathom_call_id     uuid        NOT NULL REFERENCES public.fathom_calls(id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp_seconds  integer     NOT NULL,                       -- seconds from recording start; drives the Fathom ?t= deep link
  speaker            text        NOT NULL,                       -- 'CLOSER' | 'PROSPECT'
  quote              text        NOT NULL,                       -- exact words spoken
  observation        text        NOT NULL,                       -- one factual sentence describing what happened
  type               text        NOT NULL,                       -- moment classification (see CHECK below)
  sequence_order     integer     NOT NULL,                       -- timeline ordering on the review page
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.call_highlights
  DROP CONSTRAINT IF EXISTS call_highlights_speaker_check;
ALTER TABLE public.call_highlights
  ADD CONSTRAINT call_highlights_speaker_check
  CHECK (speaker IN ('CLOSER', 'PROSPECT'));

ALTER TABLE public.call_highlights
  DROP CONSTRAINT IF EXISTS call_highlights_type_check;
ALTER TABLE public.call_highlights
  ADD CONSTRAINT call_highlights_type_check
  CHECK (type IN (
    'buying_signal',
    'objection',
    'missed_opportunity',
    'strong_moment',
    'rapport_moment',
    'disqualify_signal'
  ));

-- ─── 3) Indexes ─────────────────────────────────────────────────────────────
-- The UNIQUE constraint on call_analyses.fathom_call_id already creates an
-- index, so no extra (fathom_call_id) index needed.
CREATE INDEX IF NOT EXISTS call_analyses_user_status_idx
  ON public.call_analyses (user_id, status);

CREATE INDEX IF NOT EXISTS call_highlights_fathom_call_id_idx
  ON public.call_highlights (fathom_call_id);

CREATE INDEX IF NOT EXISTS call_highlights_user_type_idx
  ON public.call_highlights (user_id, type);

-- ─── 4) RLS + scoped SELECT policies ────────────────────────────────────────
ALTER TABLE public.call_analyses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_highlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_analyses_select_scoped" ON public.call_analyses;
CREATE POLICY "call_analyses_select_scoped"
  ON public.call_analyses FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'admin' AND user_id IN (
      SELECT user_id FROM public.user_profiles WHERE managed_by = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "call_highlights_select_scoped" ON public.call_highlights;
CREATE POLICY "call_highlights_select_scoped"
  ON public.call_highlights FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'admin' AND user_id IN (
      SELECT user_id FROM public.user_profiles WHERE managed_by = auth.uid()
    ))
  );

-- Retention: both tables cascade-delete via fathom_calls(id) AND
-- auth.users(id). A deleted Fathom call drops its analysis + highlights;
-- a deleted user drops everything. No separate prune function.
