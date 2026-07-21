-- 019_rollback.sql — reverse 019_role_manager_and_team.sql.
-- The role flip is restored from the backup table captured before the flip, so
-- only rows that were genuinely 'admin' pre-migration go back to 'admin' (rows
-- that were 'manager' all along are left untouched). Tested before the forward
-- migration ran (synthetic admin row, in a rolled-back transaction).

-- 1) Restore roles from the staged backup. The new role CHECK forbids 'admin',
--    so drop it → restore → re-add the original (owner,admin,user) check.
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
update public.user_profiles p
  set role = b.role
  from public._role_migration_019_backup b
  where p.user_id = b.user_id;
alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role = any (array['owner','admin','user']));

-- 2) (optional, only if fully reverting) drop the additive schema:
-- alter table public.user_profiles drop constraint if exists user_profiles_no_self_manage;
-- alter table public.user_profiles drop constraint if exists user_profiles_billing_status_chk;
-- alter table public.user_profiles drop column if exists billing_status;

-- 3) (optional) restore the RLS policies to their 'admin' form — see migration 003.

-- Cleanup once the migration is confirmed good:
-- drop table if exists public._role_migration_019_backup;
