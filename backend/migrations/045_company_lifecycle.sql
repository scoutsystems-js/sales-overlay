-- 045_company_lifecycle.sql — deactivate a whole company, reversibly.
--
-- ⚠⚠ THE PROBLEM THIS COLUMN EXISTS FOR, and it is the whole reason a boolean
-- is not enough on its own: reactivating a COMPANY must not silently
-- un-deactivate someone who was deactivated INDIVIDUALLY and on purpose before
-- the company ever was.
--
--   before:  rep A active,  rep B deactivated by hand (left the team)
--   deactivate company  ->  A and B both inactive
--   reactivate company  ->  A must come back,  B MUST STAY OFF
--
-- Without a record of WHO the company action switched off, reactivate can only
-- do the wrong thing: turn everyone on (resurrecting B, who was off for a
-- reason) or turn nobody on (leaving A stranded). Neither is recoverable by
-- inspection afterwards, because `active = false` looks identical either way —
-- the same absent-vs-known-absent failure as writing the null.
--
-- So the company action marks the rows IT changed, and reactivate restores
-- exactly those. Individually-deactivated users are never touched.
--
-- ⚠ NOT NULLABLE, defaulting false: every existing row was deactivated (if at
-- all) by hand, which is exactly what `false` means here. No backfill needed.

alter table public.user_profiles
  add column if not exists deactivated_with_company boolean not null default false;

comment on column public.user_profiles.deactivated_with_company is
  'TRUE only while this user is deactivated AS PART OF a company-wide deactivation. Reactivating the company restores exactly the rows carrying this flag, so a user deactivated individually beforehand stays deactivated. Cleared on reactivate and on any individual reactivate.';
