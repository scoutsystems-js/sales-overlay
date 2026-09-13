-- Counts-only calendar sharing is explicit, off by default, and bound to the
-- manager/team that received consent. A later reassignment cannot inherit it.
alter table public.google_calendar_connections
  add column share_scheduled_count boolean not null default false,
  add column share_manager_id uuid;

alter table public.google_calendar_connections
  add constraint calendar_count_sharing_binding check (
    (share_scheduled_count = false and share_manager_id is null) or
    (share_scheduled_count = true and share_manager_id is not null)
  );

comment on column public.google_calendar_connections.share_scheduled_count is
  'Owner opt-in to share only the current scheduled appointment count.';
comment on column public.google_calendar_connections.share_manager_id is
  'Manager/team consent was granted to; current assignment must still match.';
