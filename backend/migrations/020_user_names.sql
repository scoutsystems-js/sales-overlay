-- 020_user_names.sql
-- v1.4 — display names for users. Both nullable: existing users simply have no
-- name until an owner edits/creates them. Rep cards + the admin console fall
-- back to the email local-part when these are absent.

alter table public.user_profiles
  add column if not exists first_name text,
  add column if not exists last_name  text;

comment on column public.user_profiles.first_name is 'Display first name (owner-set at create/edit). Nullable — email prefix is the fallback.';
comment on column public.user_profiles.last_name  is 'Display last name (owner-set at create/edit). Nullable.';
