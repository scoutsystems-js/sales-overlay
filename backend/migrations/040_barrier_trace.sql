-- 040 — trace a late obstacle back to ground that was never established (8c).
--
-- Justin's target, in his words: "the lender only approved $5,000 — and
-- financial qualification was never established in discovery, which is where
-- that would have surfaced."
--
--   {"area_key":"financial_qualification",
--    "obstacle_quote":"it says, congratulations, we qualified for up to a loan",
--    "reason_verified":true}
--
-- Structured, never free text — same ruling as what_mattered, for the same
-- reasons: free text cannot be checked, cannot be filtered, and reads plausibly
-- whether or not it is right.
--
-- VALIDATED BY THE SAME CHAIN AS 7d, reusing resolveWhatMattered rather than a
-- second validator: the area must exist for this rep, must be marked
-- covered:false on THIS call, and the obstacle quote must reconstruct from the
-- stored transcript AS THE PROSPECT'S WORDS. Any failure stores NULL.
--
-- ⚠ THE MODEL MAY DECLINE, AND MUST. An available gap is not a causal one. The
-- link was held until the data made it a real choice: it is now emitted only
-- where 2+ areas are uncovered on 25 of 39 mapped calls, but calls with exactly
-- one gap still exist and must not force a link.
--
-- ⚠ IT IS AN OBSERVATION, NOT A FINDING. Causation is not provable here. Only
-- the scaffolding is checkable: this ground was not established, and this
-- obstacle appeared later. The surface must let the closer draw the line.
--
-- DRIVES NO SCORE.

alter table public.call_analyses
  add column if not exists barrier_trace jsonb;

comment on column public.call_analyses.barrier_trace is
  'Links a late obstacle to an uncovered discovery area: {area_key, obstacle_quote, reason_verified}. Validated by the 7d chain — area exists, area uncovered, quote reconstructs as the prospect''s words. NULL when the model declined or validation failed. An observation, never a proven finding. Coaching output only.';
