-- 073 — THE COACHING RECORD (Justin's step 3, 2026-09-05; H735).
--
-- Scout persisted nothing about what it had already told a rep except the coaching text on the
-- highlight row itself — per moment, per call, deleted on re-grade, keyed to no pattern. Every
-- synthesis, the panel and the rep line are regenerated. So a manager could not be told whether a
-- miss was the first time or the fourth. This is the SMALLEST record that answers that question:
-- which rep, which pattern, when, on which call. Nothing more.
--
-- One row per (rep, pattern, call): written by the coaching pass when it writes a coaching entry
-- for a moment whose stored fields map to a pattern key (lib/coaching-history.js patternKey — code,
-- never a model call), and backfilled once from the entries already on file. The row survives a
-- re-grade (the highlight id may dangle; the call and the pattern do not) and a prompt version bump.
CREATE TABLE IF NOT EXISTS public.coaching_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,             -- the rep coached
  team_key        uuid,                      -- the head of the rep's team at the time (managed_by, or the rep)
  pattern_key     text NOT NULL,             -- objection:<category> | missed_signal | missed_opportunity
  fathom_call_id  uuid NOT NULL,
  highlight_id    uuid,                      -- the moment coached; may dangle after a re-grade
  call_date       timestamptz,               -- the call's date (the count is "on N calls", by call date)
  surface         text NOT NULL DEFAULT 'call_coaching',
  version         text,                      -- the coaching lane version that wrote it
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern_key, fathom_call_id)
);
CREATE INDEX IF NOT EXISTS coaching_history_user_pattern_date ON public.coaching_history (user_id, pattern_key, call_date);
COMMENT ON TABLE public.coaching_history IS 'H735: one row per rep × pattern × call where Scout wrote coaching on that pattern. The record behind "coached on this N times". Survives re-grades.';
