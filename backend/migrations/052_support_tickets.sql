-- 052 · Support tickets.
--
-- ⚠⚠ THE SNAPSHOT IS STORED ON THE ROW, NOT REGENERATED ON READ. The state that
-- matters is the state they were in WHEN THEY HIT THE PROBLEM. Regenerating it
-- when an admin opens the ticket answers a different question — "what is true
-- now" — and looks identical, which is what makes it dangerous: a backlog they
-- have since cleared reads as though it never existed, and the ticket becomes
-- unanswerable without anyone noticing the substitution.
--
-- ⚠⚠ `snapshot_error` EXISTS SO A TICKET CAN LAND WITHOUT ONE. A support tool
-- that refuses a report because its own diagnostics broke fails at exactly the
-- moment someone needs to reach us. The snapshot is best-effort; the MESSAGE is
-- the ticket.
--
-- ⚠ CASCADE on the user, consistent with the deletion ruling (2026-08-26):
-- deleting a person takes their history with them.
create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Which page they were on. FREE CONTEXT the app already holds — it turns
  -- "X isn't working" into "X isn't working ON THE CALLS PAGE" at zero cost,
  -- and it is exactly what a support conversation normally has to ask for.
  page        text,
  message     text not null,
  snapshot    jsonb,
  snapshot_error text,
  -- open | closed. Two values on purpose: a status nobody maintains is worse
  -- than none, and anything richer needs a workflow that does not exist.
  status      text not null default 'open',
  closed_at   timestamptz,
  constraint support_tickets_status_check check (status in ('open', 'closed'))
);

-- The admin list reads newest-first; the user's own count reads by user.
create index if not exists support_tickets_created_idx on public.support_tickets (created_at desc);
create index if not exists support_tickets_user_idx    on public.support_tickets (user_id, created_at desc);

-- RLS with NO policies: the service role bypasses it, and nothing else may read
-- a table that carries other people's account state. Same posture as eod_edits.
alter table public.support_tickets enable row level security;

comment on table public.support_tickets is
  'Support tickets. snapshot is captured AT RAISE TIME — never regenerate it on read, that answers a different question.';
