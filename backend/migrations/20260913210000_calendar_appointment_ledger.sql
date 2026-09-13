-- Calendar is the durable source record that an appointment was booked. This
-- ledger stores only the minimum fields needed to preserve that record and to
-- reconcile it to a recording without titles, names or fuzzy time matching.
create table public.calendar_appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_calendar_id text not null check (length(provider_calendar_id) between 1 and 1024),
  provider_event_id text not null check (length(provider_event_id) between 1 and 1024),
  provider_occurrence_key text not null check (provider_occurrence_key ~ '^[0-9a-f]{64}$'),
  provider_recurring_event_id text check (length(provider_recurring_event_id) <= 1024),
  provider_original_start timestamptz,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  scheduled_time_zone text not null check (length(scheduled_time_zone) between 1 and 100),
  scheduled_calendar_date date not null,
  zoom_meeting_id text check (zoom_meeting_id ~ '^[0-9]{9,11}$'),
  unverified_title text check (length(unverified_title) <= 500),
  external_attendee_email text check (length(external_attendee_email) <= 320),
  source_updated_at timestamptz,
  source_observation text not null check (source_observation in ('qualifying', 'not_qualifying')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  matched_call_id uuid references public.fathom_calls(id) on delete set null,
  matched_at timestamptz,
  unique (user_id, provider_calendar_id, provider_event_id),
  unique (user_id, provider_calendar_id, provider_occurrence_key),
  check (scheduled_end > scheduled_start),
  check ((matched_call_id is null) = (matched_at is null))
);

create table public.calendar_appointment_history (
  appointment_id uuid not null references public.calendar_appointments(id) on delete cascade,
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  source_updated_at timestamptz,
  source_observation text not null check (source_observation in ('qualifying', 'not_qualifying')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 1024),
  provider_recurring_event_id text check (length(provider_recurring_event_id) <= 1024),
  provider_original_start timestamptz,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  scheduled_time_zone text not null check (length(scheduled_time_zone) between 1 and 100),
  scheduled_calendar_date date not null,
  zoom_meeting_id text check (zoom_meeting_id ~ '^[0-9]{9,11}$'),
  unverified_title text check (length(unverified_title) <= 500),
  external_attendee_email text check (length(external_attendee_email) <= 320),
  unique (appointment_id, state_hash),
  check (scheduled_end > scheduled_start)
);

create index calendar_appointments_reconciliation_idx
  on public.calendar_appointments (user_id, zoom_meeting_id, scheduled_calendar_date)
  where zoom_meeting_id is not null;
create index calendar_appointment_history_reconciliation_idx
  on public.calendar_appointment_history (zoom_meeting_id, scheduled_calendar_date)
  where zoom_meeting_id is not null;

alter table public.calendar_appointments enable row level security;
alter table public.calendar_appointment_history enable row level security;
revoke all on public.calendar_appointments from anon, authenticated;
revoke all on public.calendar_appointment_history from anon, authenticated;
grant all on public.calendar_appointments to service_role;
grant all on public.calendar_appointment_history to service_role;

-- One transaction records the current state and its immutable minimal revision.
-- The connection generation check makes a disconnect win over an in-flight read.
create or replace function public.record_calendar_appointment(
  p_user_id uuid,
  p_generation uuid,
  p_provider_calendar_id text,
  p_provider_event_id text,
  p_provider_occurrence_key text,
  p_provider_recurring_event_id text,
  p_provider_original_start timestamptz,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_scheduled_time_zone text,
  p_scheduled_calendar_date date,
  p_zoom_meeting_id text,
  p_unverified_title text,
  p_external_attendee_email text,
  p_source_updated_at timestamptz,
  p_source_observation text,
  p_observed_at timestamptz,
  p_state_hash text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_uuid uuid;
begin
  perform 1 from public.google_calendar_connections
    where user_id = p_user_id and generation = p_generation
    for update;
  if not found then
    raise exception 'connection_changed';
  end if;

  insert into public.calendar_appointments (
    user_id, provider_calendar_id, provider_event_id, provider_occurrence_key, provider_recurring_event_id, provider_original_start,
    scheduled_start, scheduled_end, scheduled_time_zone, scheduled_calendar_date,
    zoom_meeting_id, unverified_title, external_attendee_email,
    source_updated_at, source_observation, first_seen_at, last_seen_at
  ) values (
    p_user_id, p_provider_calendar_id, p_provider_event_id, p_provider_occurrence_key, p_provider_recurring_event_id, p_provider_original_start,
    p_scheduled_start, p_scheduled_end, p_scheduled_time_zone, p_scheduled_calendar_date,
    p_zoom_meeting_id, p_unverified_title, p_external_attendee_email,
    p_source_updated_at, p_source_observation, p_observed_at, p_observed_at
  )
  on conflict (user_id, provider_calendar_id, provider_occurrence_key) do update set
    provider_event_id = excluded.provider_event_id,
    scheduled_start = excluded.scheduled_start,
    scheduled_end = excluded.scheduled_end,
    scheduled_time_zone = excluded.scheduled_time_zone,
    scheduled_calendar_date = excluded.scheduled_calendar_date,
    zoom_meeting_id = excluded.zoom_meeting_id,
    unverified_title = excluded.unverified_title,
    external_attendee_email = excluded.external_attendee_email,
    source_updated_at = excluded.source_updated_at,
    source_observation = excluded.source_observation,
    provider_recurring_event_id = excluded.provider_recurring_event_id,
    provider_original_start = excluded.provider_original_start,
    last_seen_at = greatest(public.calendar_appointments.last_seen_at, excluded.last_seen_at)
  where public.calendar_appointments.source_updated_at is null
     or (excluded.source_updated_at is not null
       and excluded.source_updated_at >= public.calendar_appointments.source_updated_at)
  returning id into appointment_uuid;

  if appointment_uuid is null then
    select id into appointment_uuid from public.calendar_appointments
      where user_id = p_user_id
        and provider_calendar_id = p_provider_calendar_id
        and provider_occurrence_key = p_provider_occurrence_key;
  end if;

  update public.calendar_appointments
    set last_seen_at = greatest(last_seen_at, p_observed_at)
    where id = appointment_uuid;

  insert into public.calendar_appointment_history (
    appointment_id, state_hash, observed_at, source_updated_at, source_observation, provider_event_id,
    provider_recurring_event_id, provider_original_start,
    scheduled_start, scheduled_end, scheduled_time_zone, scheduled_calendar_date,
    zoom_meeting_id, unverified_title, external_attendee_email
  ) values (
    appointment_uuid, p_state_hash, p_observed_at, p_source_updated_at, p_source_observation, p_provider_event_id,
    p_provider_recurring_event_id, p_provider_original_start,
    p_scheduled_start, p_scheduled_end, p_scheduled_time_zone, p_scheduled_calendar_date,
    p_zoom_meeting_id, p_unverified_title, p_external_attendee_email
  ) on conflict (appointment_id, state_hash) do nothing;

  return appointment_uuid;
end;
$$;

revoke all on function public.record_calendar_appointment(uuid, uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, text, date, text, text, text, timestamptz, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_calendar_appointment(uuid, uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, text, date, text, text, text, timestamptz, text, timestamptz, text) to service_role;

comment on table public.calendar_appointments is
  'Minimal durable calendar appointment ledger. Not an attendance, cancellation, no-show, outcome or metric source.';
comment on column public.calendar_appointments.unverified_title is
  'Calendar label only. Never an identity, prospect-link or reconciliation key.';
comment on column public.calendar_appointments.scheduled_calendar_date is
  'Scheduled start date in scheduled_time_zone; used only for exact recording reconciliation.';
