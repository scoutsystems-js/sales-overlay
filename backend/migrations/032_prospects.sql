-- Migration 032: the PROSPECT entity (PROSPECT NAMES, sub-stage 3d-1).
--
-- ── Why this is a PREREQUISITE, not a nicety ──────────────────────────────
-- Close rate is now defined as `closed PROSPECTS ÷ TOTAL PROSPECTS` (ruling
-- 2026-08-03). That number cannot be computed without a prospect entity: a
-- prospect who takes three calls to close must count ONCE, not three times.
--
-- Honest scope note: on the CURRENT corpus grouping moves the rate by ~1 point
-- (40% per-prospect vs 39% per-call) because almost every prospect has exactly
-- one call so far. The redefinition did the work; this table makes the number
-- correct AS VOLUME GROWS, and is what the merge review (3d-2) hangs off.
--
-- ── Design ────────────────────────────────────────────────────────────────
-- prospects              — one row per real person/deal, per user.
--   display_name         — the canonical name shown in UI.
--   name_key             — normalized name used for EXACT-match attach. Unique
--                          per user so two calls resolving to the same name
--                          attach to the same prospect automatically. NULL is
--                          impossible here (a prospect always has a name); calls
--                          with no resolved name simply get no prospect_id.
--   merged_into          — set when this prospect is merged into another (3d-2).
--                          A merge is therefore REVERSIBLE and AUDITABLE: rows
--                          are never rewritten or deleted, only pointed.
--   merged_at/merged_by  — audit trail, mirroring outcome_set_at/outcome_set_by.
--
-- fathom_calls.prospect_id — the grouping key. NULLABLE by design: a call whose
--   name could not be resolved (governing principle: a wrong name is worse than
--   no name) has NO prospect, and must not be invented one.
--
-- call_analyses.prospect_name stays as the OBSERVED name per call. Keeping both
-- the observed and the canonical name is what makes a merge reviewable — you can
-- always see what each individual call actually said.
--
-- Additive only. No backfill here (a separate reviewed step attaches history).
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.prospects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  name_key      text NOT NULL,
  merged_into   uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  merged_at     timestamptz,
  merged_by     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospects_no_self_merge CHECK (merged_into IS NULL OR merged_into <> id)
);

-- Exact-match attach depends on this: one prospect per (user, normalized name).
CREATE UNIQUE INDEX IF NOT EXISTS prospects_user_name_key_idx
  ON public.prospects (user_id, name_key);

-- "All calls for this prospect" + the close-rate rollup.
CREATE INDEX IF NOT EXISTS prospects_user_idx ON public.prospects (user_id);
CREATE INDEX IF NOT EXISTS prospects_merged_into_idx
  ON public.prospects (merged_into) WHERE merged_into IS NOT NULL;

ALTER TABLE public.fathom_calls
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fathom_calls_prospect_idx
  ON public.fathom_calls (prospect_id) WHERE prospect_id IS NOT NULL;

COMMENT ON COLUMN public.fathom_calls.prospect_id IS
  'Grouping key for per-prospect close rate. NULL when the call''s prospect name could not be resolved — never invent one (a wrong identity silently miscounts the close rate).';
COMMENT ON COLUMN public.prospects.merged_into IS
  'Set by 3d-2 merge review. Merges are reversible and audited: rows are pointed, never rewritten or deleted.';

-- RLS: none, matching knowledge_base / call_analyses. All access routes through
-- the service-role backend, which enforces user scoping at query time.
