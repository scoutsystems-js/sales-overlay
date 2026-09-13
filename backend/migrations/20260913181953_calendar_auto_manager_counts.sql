-- Connecting Google Calendar automatically shares only the appointment count
-- with the connected Scout profile's current manager. Event details stay private.
update public.google_calendar_connections as connection
set
  share_scheduled_count = case
    when profile.active is distinct from false
      and (profile.managed_by is not null or profile.role in ('manager', 'owner'))
    then true else false end,
  share_manager_id = case
    when profile.active is distinct from false and profile.managed_by is not null then profile.managed_by
    when profile.active is distinct from false and profile.role in ('manager', 'owner') then profile.user_id
    else null end
from public.user_profiles as profile
where profile.user_id = connection.user_id;

comment on column public.google_calendar_connections.share_scheduled_count is
  'Automatic count-only sharing when the owner connects Google Calendar.';
comment on column public.google_calendar_connections.share_manager_id is
  'Current manager receiving automatic count-only sharing.';
