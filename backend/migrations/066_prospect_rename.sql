-- PROSPECT RENAME THAT CARRIES EVERYWHERE (Justin's ruling 2026-09-03, H707).
-- A human-source name on the PROSPECT wins over the grader and is applied to every
-- call on that prospect's row; it is the linking policy's HUMAN PATH, above the exact
-- path — a person on the call knows more than an invite list.
-- Every rename is a row: what it was, what it became, who did it, and whether it was a
-- MERGE (the new name already belonged to another prospect — confirmed, naming both,
-- never silent). Reversible through undone_at.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS human_name text;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS human_name_by uuid;
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS human_name_at timestamptz;
CREATE TABLE IF NOT EXISTS public.prospect_renames (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id           uuid NOT NULL,
  call_id            uuid REFERENCES public.fathom_calls(id) ON DELETE SET NULL,   -- the call the rename was made on
  prospect_id        uuid REFERENCES public.prospects(id) ON DELETE SET NULL,       -- the prospect renamed (or merged away)
  merged_into        uuid REFERENCES public.prospects(id) ON DELETE SET NULL,       -- set when the rename was a merge
  from_display_name  text,
  to_display_name    text NOT NULL,
  calls_moved        integer NOT NULL DEFAULT 0,
  calls_skipped      integer NOT NULL DEFAULT 0,   -- calls a person had already renamed differently
  created_at         timestamptz NOT NULL DEFAULT now(),
  undone_at          timestamptz
);
CREATE INDEX IF NOT EXISTS prospect_renames_call_idx ON public.prospect_renames (call_id);
COMMENT ON TABLE public.prospect_renames IS 'Reversible record of human prospect renames (H707): one row per rename, merges named.';
