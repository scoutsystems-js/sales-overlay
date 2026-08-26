-- 046: bound the new Fathom transcript retry.
--
-- A temporary refusal from Fathom (429 / 5xx) used to mark a call `error`
-- permanently: nothing moves 'error' back to 'pending', so the call was a silent
-- hole in the customer's data forever. lib/fathom-retry.js now requeues those —
-- and a requeue needs a bound or it loops forever on a call we have
-- misclassified.
--
-- ⚠ THE BOUND IS ATTEMPTS, NOT AGE, and that is a deliberate divergence from
-- lib/zoom-retry.js. Zoom bounds by call age because its two cases are textually
-- identical. Fathom's failures carry an HTTP status, so they are self-describing
-- — and a 429 on a two-year-old call is exactly as temporary as one on today's.
-- An age bound would permanently fail old calls on a transient blip, which is
-- the defect this exists to remove.
--
-- Additive with a default, so existing rows read 0 and become retryable.
alter table public.call_analyses
  add column if not exists transcript_attempts integer not null default 0;

comment on column public.call_analyses.transcript_attempts is
  'Consecutive TEMPORARY transcript-fetch failures (429/5xx). Bounds the requeue in lib/fathom-retry.js; reset to 0 on a successful fetch.';
