-- 043_team_name.sql — storage for the COMPANY NAME.
--
-- ⚠⚠ THE RULING (Justin, 2026-08-24): A COMPANY IS A RENAMED TEAM, in the admin
-- view only. No new tier, no new entity, no change to `managed_by`. So this is
-- deliberately ONE NULLABLE COLUMN and not a `companies` table.
--
-- WHY A COLUMN AND NOT A TABLE — the choice matters more than it looks:
--   • A team is ALREADY identified, uniquely, by the user whose `managed_by`
--     the members point at. There is no second key to invent, so a table would
--     add an id, a foreign key and a join to store one string.
--   • A `companies` table is the first half of a company TIER. Creating the
--     entity is exactly how "renamed team" quietly becomes "a thing above
--     teams", which is the ruling this migration exists to respect.
--   • Nothing else about a company is stored. If that changes — billing per
--     company, a company-level setting — promote it to a table THEN, with a
--     real reason, rather than speculatively now.
--
-- WHERE IT LIVES: on the HEAD's row (the user whose reps form the team). On a
-- user with no reps the column is meaningless and stays NULL; that is not a
-- constraint the database can express here, so it is enforced in the route
-- (PATCH /admin/companies/:id/name refuses a target with no reps) and asserted
-- in test/company.test.js.
--
-- ⚠ INERT ON PURPOSE. Applied BEFORE any code reads or writes it, so the
-- migration and the deploy cannot open a window where one disagrees with the
-- other (see the data-ahead-of-code rule in CLAUDE.md).
--
-- ⚠ NO DEFAULT, and NULL is meaningful: NULL = "nobody has named this company
-- yet", which the UI renders as the fallback rather than as blank. A default of
-- '' would make "unnamed" and "named the empty string" indistinguishable.

alter table public.user_profiles
  add column if not exists team_name text;

comment on column public.user_profiles.team_name is
  'Company/team display name. Meaningful only on rows that HEAD a team (i.e. that other user_profiles rows point at via managed_by). NULL = never named; the UI renders "Unnamed company" rather than blank or the head''s email.';
