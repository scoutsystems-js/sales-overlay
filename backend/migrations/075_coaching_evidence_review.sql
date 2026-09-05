-- Separate machine-verifiable provenance from the customer-facing advice.
ALTER TABLE public.call_highlights ADD COLUMN IF NOT EXISTS coaching_review jsonb;
COMMENT ON COLUMN public.call_highlights.coaching_review IS 'Evidence review version, verdict, KB hash and transcript context hash. NULL means not reviewed; never equivalent to approved.';
