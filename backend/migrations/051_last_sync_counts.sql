-- 051 · What the last sync actually DID.
--
-- ⚠⚠ THE FACT THAT ANSWERED A TICKET AND EXISTED NOWHERE. A live customer
-- reported "Zoom won't sync". Nothing was broken — the server log said
-- `fetched=121 inserted=121 analysis_dispatched=20` and the sync had worked
-- perfectly. That single line settled the ticket, and it lives ONLY in a
-- Railway log that does not survive a restart.
--
-- Today the connection row records WHETHER the last sync succeeded
-- (last_sync_status/_error) but not WHAT IT DID. So "it says connected and
-- nothing happened" cannot be answered without a human reading logs, which is
-- exactly the step the health snapshot exists to remove.
--
-- ⚠ WRITE-THE-NULL: these are written on every completed sync, including a
-- sync that found nothing (0, not NULL). NULL means "no sync has completed
-- since this shipped" — a different fact from "the last sync found nothing",
-- and the two must stay distinguishable.
alter table public.call_connections
  add column if not exists last_sync_fetched  integer,
  add column if not exists last_sync_inserted integer,
  add column if not exists last_sync_analyzed integer;

alter table public.fathom_connections
  add column if not exists last_sync_fetched  integer,
  add column if not exists last_sync_inserted integer,
  add column if not exists last_sync_analyzed integer;

comment on column public.call_connections.last_sync_fetched is
  'Recordings the provider returned on the last completed sync. NULL = no sync since this column shipped; 0 = the sync ran and found none.';
comment on column public.call_connections.last_sync_inserted is
  'How many of those were NEW rows. fetched>0 with inserted=0 means everything was already synced — the common "nothing happened" case.';
comment on column public.call_connections.last_sync_analyzed is
  'How many were dispatched for grading. On a FIRST sync this is capped, which is why a customer can sync 121 and see 20 graded.';
