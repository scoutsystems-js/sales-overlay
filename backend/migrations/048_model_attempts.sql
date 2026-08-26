-- 048: bound the new MODEL-call retry.
--
-- A model failure (429 / 5xx / connection) used to mark a call `error`
-- permanently: nothing moves 'error' back to 'pending', so the call was a
-- silent hole in the customer's data forever. lib/model-retry.js now requeues
-- those, and a requeue needs a bound.
--
-- ⚠ A SEPARATE COUNTER FROM transcript_attempts (migration 047), DELIBERATELY.
-- They count different things and have different caps: transcript_attempts is
-- Fathom transcript fetches (cap 5), model_attempts is Anthropic calls (cap 3,
-- on top of the SDK's own 3 tries per attempt). Overloading one counter would
-- let a transcript flake spend the model's budget and vice versa, and the two
-- would be impossible to tell apart afterwards.
alter table public.call_analyses
  add column if not exists model_attempts integer not null default 0;

comment on column public.call_analyses.model_attempts is
  'Consecutive model-call failures (429/5xx/connection) AND unusable-output retries. Bounds the requeue in lib/model-retry.js; reset to 0 on a successful analysis.';
