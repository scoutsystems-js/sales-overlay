-- Migration 033: call_analyses.qualification_covered — MEASUREMENT ONLY.
--
-- Records whether the grader observed the closer establishing the prospect's
-- financial position on a call, and the line that establishes it.
--
-- ── Why a structured field instead of a score adjustment ──────────────────
-- Three attempts to encode qualification enforcement as grader PROMPT WORDING
-- all failed, because the intended effect is smaller than the grader's own
-- noise (±14 per section, some sections bimodal, ~6 points of baseline drift on
-- identical input — see GRADER NOISE PROFILE in CLAUDE.md). A change that small
-- cannot be validated by score deltas: you end up tuning against measurement
-- error. A boolean with a supporting quote can be validated by READING it
-- against the transcript, with no medians and no delta gate.
--
-- ── This field DRIVES NOTHING ─────────────────────────────────────────────
-- No score effect, no grade effect, no UI. It is collected so coverage can be
-- measured honestly first; what it eventually feeds is a separate decision to
-- be taken once the field is trusted. Do not wire it into scoring without that
-- decision being made explicitly.
--
-- Shape: {"financial": true|false, "evidence": "<verbatim quote>"|null}
-- NULL on the column means "analysed before v12", which is distinct from
-- {"financial": false} meaning "v12 looked and found nothing".
--
-- Additive, nullable, no backfill (new calls only). Safe to re-run.

ALTER TABLE public.call_analyses
  ADD COLUMN IF NOT EXISTS qualification_covered jsonb;

COMMENT ON COLUMN public.call_analyses.qualification_covered IS
  'MEASUREMENT ONLY (v12). {financial: bool, evidence: quote|null} — did the closer establish the prospect''s financial position, by any conversational route. Drives no score and no UI; NULL means pre-v12, not "not covered".';
