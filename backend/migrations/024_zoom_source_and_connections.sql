-- Migration 024: Zoom recording source — sub-stage 1 (schema + connections).
--
-- Scout adds Zoom as a second recording source alongside Fathom. The analysis
-- pipeline is already source-agnostic from normalizeTranscript onward; this
-- migration adds only the discriminator + a unified per-provider token store.
--
-- 1) fathom_calls.source — which provider a call came from. Table name kept
--    (it's queried by literal name in 8 files; a rename is a separable
--    cleanup). fathom_call_id is already generic text and holds Zoom's
--    meeting/recording id for source='zoom' rows.
--
-- 2) public.call_connections — the UNIFIED per-user, per-provider OAuth token
--    store. Composite PK (user_id, provider). Zoom writes here from day one.
--    NOTE (deviation from the approved sub-stage-1 scope, justified at the
--    stop point): the existing fathom_connections table and its 8 read sites
--    are LEFT UNTOUCHED this sub-stage — the Fathom cutover into
--    call_connections is a separate contained step so new Zoom code never
--    shares a change with the live Fathom token-refresh path. Until that
--    cutover, call_connections holds only provider='zoom' rows.
--
-- RLS: service-role only (enable RLS, no policies), matching fathom_connections
-- and every other backend-written table.
-- Additive only. Safe to re-run.

ALTER TABLE public.fathom_calls
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'fathom'
    CHECK (source IN ('fathom', 'zoom'));

CREATE TABLE IF NOT EXISTS public.call_connections (
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider               text        NOT NULL CHECK (provider IN ('fathom', 'zoom')),
  access_token           text        NOT NULL,
  refresh_token          text        NOT NULL,
  expires_at             timestamptz,                 -- access-token expiry (nullable = always refresh before use)
  scope                  text,
  external_account_email text,                        -- provider-side identity (Fathom recorded_by / Zoom account email)
  connected_at           timestamptz NOT NULL DEFAULT now(),
  last_sync_at           timestamptz,
  last_sync_status       text,
  last_sync_error        text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.call_connections ENABLE ROW LEVEL SECURITY;
