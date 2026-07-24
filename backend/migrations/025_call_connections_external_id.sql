-- Migration 025: external_account_id on call_connections (Zoom deauthorization)
--
-- Zoom's app-deauthorization notification identifies the user by their ZOOM
-- user id (payload.user_id) — NOT their email. To delete the right connection
-- when a user removes Scout from Zoom's Added Apps, we must have stored that
-- Zoom user id at connect time. external_account_email stays for display;
-- external_account_id is the stable match key for deauthorization.
--
-- Nullable + additive: pre-existing rows have NULL (they connected before this
-- column) and must reconnect once for deauthorization to target them — fine,
-- the reviewer connects fresh during review and Justin can reconnect.

ALTER TABLE public.call_connections
  ADD COLUMN IF NOT EXISTS external_account_id text;
