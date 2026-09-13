-- Google Calendar is independent of the one-active RECORDING-source rule.
-- Server-only access: browser roles cannot read OAuth tokens or snapshots.
create table public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation uuid not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  calendar_id text,
  calendar_name text,
  time_zone text,
  title_contains text,
  last_sync_at timestamptz,
  last_sync_error text,
  snapshot jsonb,
  constraint calendar_selection_complete check (
    (calendar_id is null and title_contains is null) or
    (calendar_id is not null and calendar_name is not null and time_zone is not null and title_contains is not null and length(trim(title_contains)) between 1 and 120)
  )
);
alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from anon, authenticated;
grant all on public.google_calendar_connections to service_role;

-- At most one pending authorization per user; a new connect replaces it.
create table public.google_calendar_oauth_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null
);
alter table public.google_calendar_oauth_states enable row level security;
revoke all on public.google_calendar_oauth_states from anon, authenticated;
grant all on public.google_calendar_oauth_states to service_role;
