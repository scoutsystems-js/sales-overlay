-- 019_role_manager_and_team.sql
-- v1.4 Team Layer — Stage 1 (schema).
--   * Renames the 'admin' role → 'manager' (STAGED: a backup table captures every
--     flipped row first, so 019_rollback.sql can restore it verbatim).
--   * Adds user_profiles.billing_status (manual now, Stripe later).
--   * Adds a no-self-manage guard on managed_by (cross-row role validation —
--     managed_by must point at a manager/owner, assignee must be a user — is
--     enforced at the app layer in the PATCH endpoints; a DB trigger is overkill
--     at this scale).
--   * Updates the 3 scoped RLS policies from literal 'admin' → 'manager'.
--     (The web app uses the service-role key and bypasses RLS; these matter for
--     direct anon-key access + defense in depth. Owners still match via the
--     'owner' branch, so an owner-with-reps sees their reps there.)

-- 1) STAGED ROLLBACK BACKUP — snapshot the rows the flip will touch. Idempotent.
create table if not exists public._role_migration_019_backup (
  user_id      uuid primary key,
  role         text not null,
  backed_up_at timestamptz not null default now()
);
insert into public._role_migration_019_backup (user_id, role)
  select user_id, role from public.user_profiles where role = 'admin'
  on conflict (user_id) do nothing;

-- 2) FORWARD FLIP  admin → manager. The existing role CHECK only allows
--    (owner,admin,user), so drop it BEFORE the flip, flip, then re-add the
--    constraint with the new vocabulary (owner,manager,user) — hard-cut, no
--    'admin' (prod has 0 admins so nothing can violate the new constraint).
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
update public.user_profiles set role = 'manager' where role = 'admin';
alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role = any (array['owner','manager','user']));

-- 3) billing_status — trial | active | past_due | canceled (default trial)
alter table public.user_profiles
  add column if not exists billing_status text not null default 'trial';
do $$ begin
  alter table public.user_profiles
    add constraint user_profiles_billing_status_chk
    check (billing_status in ('trial','active','past_due','canceled'));
exception when duplicate_object then null; end $$;

-- 4) managed_by integrity: never manage yourself (cross-row role check is app-side)
do $$ begin
  alter table public.user_profiles
    add constraint user_profiles_no_self_manage
    check (managed_by is null or managed_by <> user_id);
exception when duplicate_object then null; end $$;

-- 5) RLS: 'admin' → 'manager' (owner branch unchanged; owner-with-reps sees reps there)
drop policy if exists "user_profiles_select" on public.user_profiles;
create policy "user_profiles_select"
  on public.user_profiles for select
  using (
    user_id = auth.uid()
    or public.current_user_role() = 'owner'
    or (public.current_user_role() = 'manager' and managed_by = auth.uid())
  );

drop policy if exists "sessions_select_scoped" on public.call_sessions;
create policy "sessions_select_scoped"
  on public.call_sessions for select
  using (
    user_id = auth.uid()
    or public.current_user_role() = 'owner'
    or (public.current_user_role() = 'manager' and user_id in (
      select user_id from public.user_profiles where managed_by = auth.uid()
    ))
  );

drop policy if exists "logs_select_scoped" on public.session_logs;
create policy "logs_select_scoped"
  on public.session_logs for select
  using (
    user_id = auth.uid()
    or public.current_user_role() = 'owner'
    or (public.current_user_role() = 'manager' and user_id in (
      select user_id from public.user_profiles where managed_by = auth.uid()
    ))
  );

comment on column public.user_profiles.billing_status is
  'trial|active|past_due|canceled — manual until Stripe (v1.5). Owner-editable in the admin console.';
