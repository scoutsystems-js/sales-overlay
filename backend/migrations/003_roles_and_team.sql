-- Migration 003: user roles + team model for v1.1.0
--
-- Adds a role column to user_profiles (owner/admin/user), a managed_by
-- column for flat 2-tier teams (admin → their users), a security-definer
-- helper current_user_role(), and revised SELECT policies on user_profiles,
-- call_sessions, and session_logs so each role sees the right scope of data.
--
-- Additive only:
--   - new columns: user_profiles.role, user_profiles.managed_by
--   - new helper: public.current_user_role()
--   - new index: user_profiles_managed_by_idx
--   - revised SELECT policies on three tables (old names dropped, new
--     names installed)
-- Untouched (by design):
--   - INSERT and UPDATE policies on user_profiles from migration 001.
--     Admins cannot insert rows for other users, and admins cannot update
--     other users' rows (including anyone's role column). Role changes
--     must be made via service-role SQL in the Supabase dashboard, or a
--     future backend endpoint gated by requireRole(['owner']).
--   - call_sessions / session_logs INSERT policies (there are none — the
--     backend writes these via the service-role key, bypassing RLS).
--
-- Lifecycle note — signup does NOT create user_profiles rows:
--   The /auth/signup route only calls supabase.auth.signUp (auth.users
--   row only). The first user_profiles row is created by the desktop
--   onboarding wizard's save-profile upsert in src/main/index.js. New
--   signups therefore get role='user' via the column default on that
--   first upsert. Signups who never open onboarding have no profile
--   row — requireRole() in the backend defaults them to 'user' in
--   memory. Consequence: any future admin listing that reads
--   user_profiles will miss users who never completed onboarding.
--   Fix queued for v1.1.1 — add a backend post-signup upsert that
--   creates an empty user_profiles row.

-- ─────────────────────────────────────────────────────────────────────────────
-- Column additions
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.user_profiles
  add column if not exists role text not null default 'user';

alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('owner', 'admin', 'user'));

-- managed_by: uuid of the admin this user belongs to. Null for owners,
-- admins themselves, and any unassigned users. on delete set null so an
-- admin account deletion doesn't cascade-delete their managed users'
-- profiles — they just become unassigned.
alter table public.user_profiles
  add column if not exists managed_by uuid
  references auth.users(id) on delete set null;

create index if not exists user_profiles_managed_by_idx
  on public.user_profiles (managed_by);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper function: returns the caller's role from user_profiles, or null
-- if no profile exists. security definer so it bypasses RLS when invoked
-- from a policy on user_profiles itself (otherwise infinite recursion).
-- search_path pinned to public per Supabase RLS hygiene guidance.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_profiles where user_id = auth.uid();
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Revised SELECT policies — owner sees all, admin sees own + managed,
-- everyone else sees own. INSERT/UPDATE policies from migration 001
-- remain unchanged by design.
-- ─────────────────────────────────────────────────────────────────────────────

-- user_profiles SELECT
drop policy if exists "user_profiles_select" on public.user_profiles;
create policy "user_profiles_select"
  on public.user_profiles for select
  using (
    user_id = auth.uid()
    or public.current_user_role() = 'owner'
    or (public.current_user_role() = 'admin' and managed_by = auth.uid())
  );

-- call_sessions SELECT (replacing the 'sessions_select_own' policy from 002)
drop policy if exists "sessions_select_own" on public.call_sessions;
drop policy if exists "sessions_select_scoped" on public.call_sessions;
create policy "sessions_select_scoped"
  on public.call_sessions for select
  using (
    user_id = auth.uid()
    or public.current_user_role() = 'owner'
    or (public.current_user_role() = 'admin' and user_id in (
      select user_id from public.user_profiles where managed_by = auth.uid()
    ))
  );

-- session_logs SELECT (replacing the 'logs_select_own' policy from 002)
drop policy if exists "logs_select_own" on public.session_logs;
drop policy if exists "logs_select_scoped" on public.session_logs;
create policy "logs_select_scoped"
  on public.session_logs for select
  using (
    user_id = auth.uid()
    or public.current_user_role() = 'owner'
    or (public.current_user_role() = 'admin' and user_id in (
      select user_id from public.user_profiles where managed_by = auth.uid()
    ))
  );
