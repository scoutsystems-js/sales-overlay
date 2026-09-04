-- 069 — the capture of causes (H719, Justin's ruling 2026-09-03).
-- A buying signal is an EFFECT; from v41 the extractor also stores its CAUSE — the
-- closer's move from a CLOSED vocabulary of sixteen, two or three verbatim closer
-- lines each located in the stored transcript (one unlocatable line refuses the
-- whole cause: `none — not_evidenced`), the arc's start, and a one-sentence
-- framework summary — and, on every prospect-spoken moment, what the closer did
-- with the disclosure: let_it_slide · dug_deeper · banked_and_used (the last
-- only with a located callback AFTER the moment).
-- NULL = not assessed (pre-v41, or the model offered nothing); `none` is a result.
ALTER TABLE call_highlights ADD COLUMN IF NOT EXISTS cause jsonb;
ALTER TABLE call_highlights ADD COLUMN IF NOT EXISTS disclosure_handling jsonb;
COMMENT ON COLUMN call_highlights.cause IS 'H719: {move|none, none_reason, evidence[{timestamp_seconds, quote, located}], arc_start_seconds, summary, refused}. Buying signals only. NULL = not assessed.';
COMMENT ON COLUMN call_highlights.disclosure_handling IS 'H719: {tier let_it_slide|dug_deeper|banked_and_used|null, none_reason, response, callback, refused}. Prospect-spoken moments only. NULL = not assessed.';
