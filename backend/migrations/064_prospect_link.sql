-- LINKING (Justin's approved policy, 2026-09-03, H705). Path 1 keys a prospect by the
-- ONE external invitee email on the call — the only exact path; unique per rep.
-- prospect_link_path records WHICH path attached each new call, so the first real
-- week's yield per path can be measured ("invitee_email" | "title_name" |
-- "display_name" | "resolved_name"; NULL = attached before linking existed, or not attached).
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS prospects_user_email_idx ON prospects (user_id, email) WHERE email IS NOT NULL;
COMMENT ON COLUMN prospects.email IS 'The prospect''s invitee email (path 1 of the linking policy); unique per rep; NULL = never seen on an invite.';
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS prospect_link_path text;
COMMENT ON COLUMN fathom_calls.prospect_link_path IS 'Which linking path attached this call: invitee_email | title_name | display_name | resolved_name; NULL = pre-linking or unattached.';
