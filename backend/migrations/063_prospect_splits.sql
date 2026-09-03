-- THE SPLITTING PASS (Justin's ruling 2026-09-03, H702): a one-word prospect whose
-- titles carry two or more different surnames is a COLLISION, not a prospect.
-- Every call moved by the pass is recorded here so it can be undone: what was one,
-- what it became, and why. Undo = set fathom_calls.prospect_id back to
-- from_prospect_id and stamp undone_at (lib/prospect-split.js undoSplits).
CREATE TABLE IF NOT EXISTS public.prospect_splits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_id           uuid NOT NULL REFERENCES public.fathom_calls(id) ON DELETE CASCADE,
  from_prospect_id  uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  to_prospect_id    uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  to_display_name   text NOT NULL,
  reason            jsonb NOT NULL,          -- {rule, title, title_name, first_token, surname, from_display_name}
  created_at        timestamptz NOT NULL DEFAULT now(),
  undone_at         timestamptz
);
CREATE INDEX IF NOT EXISTS prospect_splits_call_idx ON public.prospect_splits (call_id);
COMMENT ON TABLE public.prospect_splits IS 'Reversible record of the collision-splitting pass: one row per call moved from a one-word prospect to a title-surname prospect (H702).';
