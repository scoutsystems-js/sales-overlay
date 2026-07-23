-- Migration 023: provider-agnostic billing seam (Stage 5 — account page).
--
-- No payment provider exists today and nobody pays. These columns are the
-- CONTAINED attachment surface so that a future Stripe OR Whop integration
-- stage fills three ids and maps statuses — no refactor, no migration churn.
--
--   billing_provider — NULL = manual/admin-managed (today's world, the admin
--     console PATCH stays the only writer of billing_status). CHECK'd to the
--     two candidate providers so a typo can't invent a third integration.
--   billing_external_customer_id / billing_external_subscription_id —
--     Stripe cus_/sub_ or Whop member/membership ids. Opaque text on purpose.
--   billing_synced_at — last provider→internal sync stamp.
--   billing_plan — product-plan slug (pricing page will sell single_user at
--     $199/mo; team pricing undecided). Deliberately NO CHECK constraint yet
--     (Justin's ruling): plans are a product surface in motion. NULL =
--     unset/legacy.
--
-- billing_status (migration 019) REMAINS the canonical internal status —
-- future webhooks map provider states INTO it; nothing ever reads
-- provider-specific state directly.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS billing_provider text
    CHECK (billing_provider IN ('stripe', 'whop'));

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS billing_external_customer_id text;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS billing_external_subscription_id text;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS billing_synced_at timestamptz;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS billing_plan text;
