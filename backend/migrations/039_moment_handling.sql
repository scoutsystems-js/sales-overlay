-- 039 — did the closer engage with what the prospect raised, or move past it?
--
-- v17 created risk_signal and barrier. Both can be raised and then dropped, and
-- THAT is the coachable event — but it is invisible unless someone re-listens.
-- The motivating case, from a real call: the prospect discloses "I lost over
-- $300,000", and 53 seconds later the closer answers "don't bring the
-- ex-girlfriend into the conversation with a date with the hot blonde… I
-- respect it, I know what you went through." Warm, verbose, and it never
-- touches the concern.
--
--   addressed — the closer engaged with the SUBSTANCE of what was raised
--   deflected — acknowledged it and moved on. Warmth, length and sympathy are
--               NOT engagement. This is the value that earns the feature: no
--               heuristic over the transcript can see it. Measured before
--               building: the closer said 20 words in the 15 turns after the
--               disclosure, and the real response came 16 turns later — so both
--               "did he reply" and "how much did he say" score the deflection
--               as engagement, exactly backwards.
--   ignored   — no response at all
--
-- NULLABLE with no default: NULL means "not assessed" (every row predating v18,
-- and every type that does not carry this), which must stay distinguishable
-- from "assessed, and he ignored it".
--
-- The accompanying closer_response quote is verified at write time by
-- lib/quote-locate.js into closer_response_verified (migration 035) — the same
-- path objections already use. An unprovable quote is stored but never shown.

alter table public.call_highlights
  add column if not exists handling text;

alter table public.call_highlights
  drop constraint if exists call_highlights_handling_check;

alter table public.call_highlights
  add constraint call_highlights_handling_check
  check (handling is null or handling = any (array['addressed'::text, 'deflected'::text, 'ignored'::text]));

comment on column public.call_highlights.handling is
  'Did the closer engage with the substance of a risk_signal/barrier, or move past it? addressed|deflected|ignored. NULL = not assessed (pre-v18 or a type that does not carry it). Warmth and length are not engagement.';
