-- 080 — verified factual objection sequence for Personal Coaching.
-- NULL means the call did not supply the complete, speaker-verified sequence.
-- This records evidence only; it changes no outcome, grade, rate or call kind.
ALTER TABLE call_highlights ADD COLUMN IF NOT EXISTS coaching_sequence jsonb;
COMMENT ON COLUMN call_highlights.coaching_sequence IS 'Personal Coaching factual sequence: prospect concern, closer isolation, prospect confirmation, closer response, each transcript-located. NULL = not evidenced.';
