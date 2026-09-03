-- THE REVIEW QUEUE (Justin's ruling 2026-09-03, H712). Every "not a sales call" verdict the
-- grader writes lands in a queue with its reason; a manager (or above) confirms or corrects.
-- NOTHING IS AUTO-MARKED: a confirmation goes through the ONE not-a-sales-call mark, which
-- remains the only thing that removes a call from a rate. Confirmations and corrections are
-- counted SEPARATELY — a correction is data, the next fix's control set.
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS sales_call_review text CHECK (sales_call_review IS NULL OR sales_call_review IN ('confirmed','corrected'));
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS sales_call_reviewed_by uuid;
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS sales_call_reviewed_at timestamptz;
COMMENT ON COLUMN call_analyses.sales_call_review IS 'A manager''s answer to a not_sales verdict: confirmed (the call was marked not-a-sales-call through the one mark) | corrected (it is a sales call). NULL = pending.';
