-- 059 — attribute every model call to a user, a call and a LANE.
--
-- ⚠⚠ THE PROBLEM THIS SOLVES: Anthropic returns usage.input_tokens and
-- usage.output_tokens on EVERY response and Scout discarded all of it. 21 call
-- sites across 11 modules, no usage table, no attribution. So "roughly $X per
-- closer" was arithmetic on an assumption, and the genuinely unexplored lever —
-- whether every lane needs the largest model — could not even be framed.
--
-- ⚠ ADDITIVE, NEW CALLS ONLY, NO BACKFILL. The token counts for past calls are
-- gone; they were never captured. Same shape as recorded_by and the six
-- discovery items — and for the same reason, a guessed number would be worse
-- than an absent one because it would make a cost report look complete.
--
-- ⚠⚠ user_id and fathom_call_id are NULLABLE ON PURPOSE. Several lanes are
-- genuinely not per-call (a team digest, a synthesis over a date range) and one
-- is not per-user (the cron). NULL here means "this lane has no such subject",
-- which is a different fact from "we failed to record it" — recording a
-- placeholder would collapse them.
--
-- ⚠ NO FOREIGN KEYS. This is an append-only measurement log; a deleted user or
-- a purged call must not silently erase the record that the spend happened.

create table if not exists public.model_usage (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_id        uuid,
  fathom_call_id uuid,
  lane           text not null,
  model          text not null,
  input_tokens   integer,
  output_tokens  integer,
  ok             boolean not null default true
);

comment on table public.model_usage is
  'Append-only model-spend log. One row per Anthropic response. NULL user_id or '
  'fathom_call_id means the lane has no such subject, not that it was lost.';

create index if not exists idx_model_usage_created on public.model_usage (created_at desc);
create index if not exists idx_model_usage_user    on public.model_usage (user_id, created_at desc);
create index if not exists idx_model_usage_lane    on public.model_usage (lane, created_at desc);

alter table public.model_usage enable row level security;
-- no policies: service-role writes only, exactly like the other backend tables
