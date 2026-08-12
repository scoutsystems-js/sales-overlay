-- 037 — "the question that mattered", per call (7d).
--
-- {"area_key":"income_goal_and_motivation",
--  "reason_evidence":"I run a counseling practice and I want out of the day job.",
--  "reason_verified":true}
--
-- Structured on purpose. Justin's ruling: it names an area_key and cites the
-- prospect's own PROVEN quote, never free text — free text cannot be checked,
-- cannot be filtered against the example library (7e), and reads plausibly
-- whether or not it is right.
--
-- Only ever written when ALL of these hold, checked server-side rather than
-- trusted from the model: the area is one the rep actually has; it was NOT
-- covered on this call; and the reason is a line the PROSPECT really spoke
-- (verified by lib/quote-locate against the stored transcript). Any failure
-- stores NULL — emitting nothing beats reaching for a plausible pairing,
-- because a fabricated "question that mattered" coaches a call that never
-- happened.
--
-- role_inverted marks a call where the RECORDED USER is the one being sold to,
-- so closer/prospect are inverted relative to recorded_by. Found live: the
-- closer's own disclosures ("I own a primary residence", "I have cash on hand")
-- were counted as covered prospect ground. Coaching is suppressed on these
-- calls and the review page SAYS SO — a blank panel reads as a bug.
--
-- DRIVES NO SCORE. Same discipline as coverage and qualification_covered.

alter table public.call_analyses
  add column if not exists what_mattered jsonb,
  add column if not exists role_inverted boolean;

comment on column public.call_analyses.what_mattered is
  'The highest-priority UNCOVERED area with the prospect''s own proven quote as the reason: {area_key, reason_evidence, reason_verified}. NULL when no uncovered area had a provable reason — never a guess. Coaching output only.';

comment on column public.call_analyses.role_inverted is
  'TRUE when the recorded user appears to be the one being sold to, so closer/prospect roles are inverted. Coaching is suppressed and the reason shown. NULL = not assessed (predates 7d or no deterministic speakers).';
