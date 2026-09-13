-- A single, server-only cutoff for a deliberate application-wide sign-out.
-- Normal browser clients cannot read this table because RLS is enabled and no
-- policies are granted. The backend service-role client is the sole reader.
create table if not exists public.auth_runtime_controls (
  id boolean primary key default true check (id),
  minimum_session_issued_at timestamptz not null default 'epoch'::timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.auth_runtime_controls enable row level security;

insert into public.auth_runtime_controls (id, minimum_session_issued_at)
values (true, 'epoch'::timestamptz)
on conflict (id) do nothing;
