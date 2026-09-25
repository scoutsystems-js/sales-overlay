-- Company billing foundation — current per-seat offer only.
--
-- A Scout company is already identified by the user who heads its team:
-- `user_profiles.managed_by` points to that user. There is deliberately no
-- second companies table. Billing is the first company-level fact, so it gets
-- a separate one-to-one record keyed by that existing head id.
--
-- This migration stores billing state; it creates no Stripe customer, no
-- checkout session and no charge. Those are server-side actions after an owner
-- explicitly creates an approved checkout link.

create table if not exists public.company_billing (
  company_head_id uuid primary key references public.user_profiles(user_id) on delete cascade,
  billing_email text not null,
  closer_seats integer not null check (closer_seats between 0 and 500),
  manager_seats integer not null check (manager_seats between 0 and 100),
  check (closer_seats + manager_seats >= 1),
  provider text,
  status text not null default 'draft'
    check (status in ('draft', 'checkout_started', 'active', 'trialing', 'past_due', 'canceled')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  stripe_closer_price_id text,
  stripe_manager_price_id text,
  current_period_end timestamptz,
  created_by uuid references public.user_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.company_billing is
  'Server-only Stripe billing state for one Scout company. Company identity is its existing team head (user_profiles.user_id). The current offer bills closer and manager-access seats separately.';

alter table public.company_billing enable row level security;

-- The browser does not query this table. All reads and writes go through
-- authenticated server routes using the Supabase service role, so no Stripe
-- identifiers or billing contact data become browser-readable by accident.
revoke all on table public.company_billing from anon, authenticated;
