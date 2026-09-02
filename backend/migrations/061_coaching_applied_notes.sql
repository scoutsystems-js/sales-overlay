-- Fine Tune Coaching (2026-09-02): which team coaching notes shaped a moment's
-- coaching. Written by the coaching pass for NEW calls only; NULL means no note
-- was in play (or the call predates the feature). A jsonb array of
-- knowledge_base ids — joinable to the correction rows, never prose.
ALTER TABLE call_highlights ADD COLUMN IF NOT EXISTS coaching_applied_notes jsonb;
COMMENT ON COLUMN call_highlights.coaching_applied_notes IS 'knowledge_base ids (category coaching_correction) the coaching pass applied to this moment; NULL = none in play.';
