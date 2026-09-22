-- 082_shared_manager_assignments.sql
-- A closer keeps user_profiles.managed_by as their home manager. This table
-- grants one or more additional managers the same existing team visibility and
-- coaching access without changing the closer's home-team settings.

create table if not exists public.manager_rep_assignments (
  manager_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  rep_user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (manager_user_id, rep_user_id),
  constraint manager_rep_assignments_no_self check (manager_user_id <> rep_user_id)
);

create index if not exists manager_rep_assignments_rep_idx
  on public.manager_rep_assignments (rep_user_id);

alter table public.manager_rep_assignments enable row level security;

-- This is server-managed only. The application already uses the server role
-- after its Express authorization checks, so browser roles receive no path to
-- enumerate or alter assignments directly.
revoke all on table public.manager_rep_assignments from anon, authenticated;
grant select, insert, update, delete on table public.manager_rep_assignments to service_role;

comment on table public.manager_rep_assignments is
  'Additional manager access for a closer. user_profiles.managed_by remains the closer’s home manager.';
