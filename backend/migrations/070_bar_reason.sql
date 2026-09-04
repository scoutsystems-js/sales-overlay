-- 070 — the selectivity bar (H721, Justin's ruling 2026-09-04, forward only).
-- Every moment captured from v42 carries the reason it exists ("a missed opportunity",
-- "a buying signal the closer earned (digging for pain)"…). NULL = captured before the
-- bar; nothing existing is touched — the bar governs capture, never history.
ALTER TABLE call_highlights ADD COLUMN IF NOT EXISTS bar_reason text;
COMMENT ON COLUMN call_highlights.bar_reason IS 'H721: why this moment passed the selectivity bar (coachable/applaudable reason, plain words). NULL = pre-v42.';
