-- Migration 002: call_sessions + session_logs
--
-- Cloud logging for Scout. Every session the user starts gets a row in
-- call_sessions; every [main]/[deepgram]/[claude]/[memory] log line the
-- desktop app emits during that session gets a row in session_logs.
--
-- RLS: users can only read their own sessions/logs. Inserts happen via the
-- backend using the service role key, so no client-side INSERT policy.
--
-- Retention: a scheduled cron deletes logs older than 14 days to stay
-- under Supabase's free-tier 500MB ceiling.

-- ─────────────────────────────────────────────────────────────────────────────
-- call_sessions: one row per session (click Start → click Stop = one session)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.call_sessions (
  session_id        uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  outcome           text,            -- 'win' | 'loss' | 'follow_up' | null (mid-call or no mark)
  client_version    text,            -- e.g. "1.0.5" — pulled from app's package.json at start
  platform          text,            -- e.g. "darwin-arm64"
  error_count       integer         not null default 0,
  log_count         integer         not null default 0
);

create index if not exists call_sessions_user_idx
  on public.call_sessions (user_id, started_at desc);

alter table public.call_sessions enable row level security;

drop policy if exists "sessions_select_own" on public.call_sessions;
create policy "sessions_select_own"
  on public.call_sessions for select
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- session_logs: one row per log line the app would have sent to stdout
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.session_logs (
  id          bigserial   primary key,
  session_id  uuid        not null references public.call_sessions(session_id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  logged_at   timestamptz not null,          -- client-supplied — preserves order across batch flushes
  received_at timestamptz not null default now(),
  level       text        not null,          -- 'info' | 'warn' | 'error'
  tag         text,                          -- '[main]', '[claude]', '[deepgram]', '[memory]', '[auth]', etc.
  message     text        not null
);

-- Fast lookups: by session (scroll one call's logs) and by user+time (recent activity).
create index if not exists session_logs_session_idx
  on public.session_logs (session_id, logged_at);

create index if not exists session_logs_user_time_idx
  on public.session_logs (user_id, logged_at desc);

alter table public.session_logs enable row level security;

drop policy if exists "logs_select_own" on public.session_logs;
create policy "logs_select_own"
  on public.session_logs for select
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Retention: delete logs + closed sessions older than 14 days
-- ─────────────────────────────────────────────────────────────────────────────
-- This is a function; scheduling via pg_cron is a separate step done in the
-- Supabase dashboard (Database → Cron). The function itself is idempotent
-- and safe to run manually or on a schedule.
create or replace function public.prune_old_session_data()
returns void
language plpgsql
security definer
as $$
begin
  delete from public.session_logs
    where logged_at < now() - interval '14 days';

  delete from public.call_sessions
    where coalesce(ended_at, started_at) < now() - interval '14 days';
end;
$$;
