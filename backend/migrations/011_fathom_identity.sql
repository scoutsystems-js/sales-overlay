-- Migration 011: Connected user's Fathom identity email
--
-- Fathom's /meetings endpoint returns the ENTIRE team workspace's recordings
-- for an OAuth token — there is no implicit per-user scoping. To store only the
-- calls the connected user actually recorded, sync must pass the server-side
-- filter recorded_by[]=<email>. That requires knowing the user's Fathom email.
--
-- Fathom exposes no identity/self endpoint (the whole API is 8 endpoints: none
-- of them /me) and the OAuth grant uses scope=public_api (not OIDC), so the
-- token response carries no identity. We therefore capture the email from the
-- user directly (a one-time dashboard prompt, pre-filled with their Scout login
-- email) and persist it here.
--
-- Nullable: existing connections start null. The sync route treats null as
-- "identity not set" and returns needs_identity instead of syncing unfiltered.
ALTER TABLE public.fathom_connections
  ADD COLUMN IF NOT EXISTS fathom_email text;
