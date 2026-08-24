-- 044_sync_window.sql — let the user choose how far back the FIRST sync reaches.
--
-- ⚠⚠ THE PROBLEM THIS SOLVES IS NOT A DATE WINDOW. Measured 2026-08-24:
--   • Fathom's page size is HARD-CODED at 10 and ignores any `limit` param
--     (probed: ?limit=25 and ?limit=100 both return 10 and echo "limit": 10).
--   • MAX_PAGES was 20, so a first sync could never fetch more than 200 calls.
--   • Josh got exactly 200, which happened to span 38 days — so "it only goes
--     back a month" was a SYMPTOM of a 200-CALL cap. Nobody chose 30 days.
--   • His true all-time history is 560 meetings back to 2021-09-16, so the cap
--     was silently missing 360 of his calls.
--
-- ⚠⚠ AND THE OLDER TAIL WAS UNREACHABLE, WHICH IS THE PART THAT MADE IT STICK.
-- Once the first sync stamps `last_sync_at`, every later sync passes
-- `created_after = last_sync_at` and therefore only ever fetches NEWER calls.
-- The UI's "run sync again to fetch the rest" was FALSE: running it again can
-- never reach backwards. That is why this column exists rather than a one-off
-- bigger page cap.
--
-- WHY A TEXT ENUM AND NOT A NUMBER OF DAYS: "all time" has no honest integer.
-- 0 and NULL both have to mean something else (NULL = never chosen), so a
-- numeric column would need a sentinel, and a sentinel is a value whose meaning
-- lives somewhere other than the column. Three named choices cannot be
-- misread.
--
-- NULL = the user has never chosen. Existing connections (Josh's included) are
-- NULL, and the code treats that as the historical default so nothing changes
-- underneath anyone until they pick.

alter table public.fathom_connections
  add column if not exists sync_window text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fathom_connections_sync_window_check'
  ) then
    alter table public.fathom_connections
      add constraint fathom_connections_sync_window_check
      check (sync_window is null or sync_window in ('30d', '90d', 'all'));
  end if;
end $$;

comment on column public.fathom_connections.sync_window is
  'How far back the user asked the first sync to reach: 30d | 90d | all. NULL = never chosen (treated as the historical default). Also drives the re-runnable history backfill, which deliberately IGNORES last_sync_at so the older tail is reachable after the first sync has already stamped it.';
