-- Migration 001: user_profiles table
-- Stores onboarding wizard data per user (niche, offer, pricing, payment links).
-- RLS: users can only read/write their own row. No DELETE — profiles cascade
-- from auth.users on account deletion.

create table if not exists public.user_profiles (
  user_id         uuid        primary key references auth.users(id) on delete cascade,
  niche           text,
  offer           text,
  price_pif       integer,
  price_2pay      integer,
  qualifications  text,
  pif_url         text,
  twopay_url      text,
  affirm_url      text,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Auto-update updated_at on any row update
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_select" on public.user_profiles;
create policy "user_profiles_select"
  on public.user_profiles for select
  using (user_id = auth.uid());

drop policy if exists "user_profiles_insert" on public.user_profiles;
create policy "user_profiles_insert"
  on public.user_profiles for insert
  with check (user_id = auth.uid());

drop policy if exists "user_profiles_update" on public.user_profiles;
create policy "user_profiles_update"
  on public.user_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
