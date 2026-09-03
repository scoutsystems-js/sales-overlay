-- The prospect-name lift, step 1 (Justin's ruling 2026-09-03, H700): STORE the
-- exact identity Fathom already sends. Store, do not resolve — no column here is
-- read by any grouping, merge or rate yet. New calls only; nothing re-analyses.
--
-- NULL = not received / not captured (pre-062 rows, Zoom, a payload without the
-- field). [] = received and empty. The two must never be folded ("write the null").
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS calendar_invitees jsonb;
COMMENT ON COLUMN fathom_calls.calendar_invitees IS 'Fathom meeting.calendar_invitees at sync: [{name,email,email_domain,is_external,matched_speaker_display_name}]; NULL = not received.';
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS speaker_identities jsonb;
COMMENT ON COLUMN fathom_calls.speaker_identities IS 'One entry per transcript speaker at analysis: [{display_name,email,turns}], email from matched_calendar_invitee_email; NULL = not captured (Zoom, pre-062). Never per turn (RULING 1).';
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS title_name_segment text;
COMMENT ON COLUMN fathom_calls.title_name_segment IS 'The title''s last "|" segment verbatim, 2-4 tokens, at sync. A segment, not a resolved name; NULL = no usable segment.';
