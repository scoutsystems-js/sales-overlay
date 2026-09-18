-- 081 — verified factual evidence for Discovery, Pitch and Close coaching.
-- NULL means the full stage-specific exchange was not evidenced. This is not a
-- grade, outcome, rate, or coaching conclusion.
ALTER TABLE call_highlights ADD COLUMN IF NOT EXISTS coaching_evidence jsonb;
COMMENT ON COLUMN call_highlights.coaching_evidence IS 'Stage-specific, transcript-located coaching exchange for discovery, pitch or close. NULL = not evidenced.';
