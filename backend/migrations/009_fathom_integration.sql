-- Migration 009: Fathom OAuth integration for Scout v2.0 Phase 1
--
-- Scout v2.0 pivots from live teleprompter to a post-call intelligence
-- platform. Phase 1 is Fathom OAuth + auto-sync — closers connect their
-- Fathom account once, Scout pulls their completed calls in the
-- background. No manual import, no API keys handed to the user.
--
-- Adds two tables, both scoped per user via auth.users(id):
--
--   public.fathom_connections — one row per user (PRIMARY KEY user_id).
--                               Stores the OAuth token pair + the metadata
--                               needed to schedule and audit syncs.
--   public.fathom_calls       — one row per Fathom meeting we've seen.
--                               UNIQUE (user_id, fathom_call_id) is the
--                               dedup key. sync_status tracks the Phase 2
--                               post-call analysis lifecycle.
--
-- Token lifecycle notes for the route + sync code (NOT enforced here):
--   - Fathom refresh tokens are single-use per Fathom docs. Every refresh
--     returns a NEW refresh_token that must replace the stored one in the
--     same transaction as the new access_token + expires_at.
--   - On refresh failure we mark last_sync_status='error' and surface
--     last_sync_error on the dashboard, but we never DELETE the
--     connection row — that would discard a working connection on
--     transient Fathom outages. Only the user explicitly reconnecting
--     should replace the tokens.
--
-- RLS policies mirror migration 003's scoped pattern (own /
-- admin-managed / owner) so admins see their managed users' Fathom
-- data and owners see everything. The current_user_role() helper from
-- migration 003 is required and assumed present. Like call_sessions
-- and session_logs, there are NO INSERT/UPDATE policies — the backend
-- writes via the service-role key, bypassing RLS by design.
--
-- The OAuth callback at /auth/fathom/callback is intentionally
-- UNAUTHENTICATED (Fathom redirects to it as a plain browser navigation,
-- no Authorization header). User identity in that route comes from a
-- signed JWT in the OAuth state parameter — NOT from any req.user —
-- and only after JWT signature + expiry validation does the route
-- UPSERT into fathom_connections. The PRIMARY KEY on user_id makes
-- that UPSERT idempotent: a user re-connecting just overwrites their
-- existing row.
--
-- Indexes:
--   fathom_calls_user_date_idx     — for the "recent calls" view on the
--                                    dashboard sorted by call_date DESC.
--   fathom_calls_user_status_idx   — for the Phase 2 "process pending
--                                    calls" worker that polls by
--                                    sync_status='pending'.
--
-- Additive only. Safe to re-run.

-- ─── 1) fathom_connections ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fathom_connections (
  user_id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token      text        NOT NULL,
  refresh_token     text        NOT NULL,
  expires_at        timestamptz,                       -- nullable: Fathom token response shape unverified; null = "always refresh before each call"
  scope             text        DEFAULT 'public_api',
  connected_at      timestamptz NOT NULL DEFAULT now(),
  last_sync_at      timestamptz,                       -- null until the first sync completes
  last_sync_status  text,                              -- 'ok' | 'error' | 'in_progress' | null (never synced)
  last_sync_error   text,                              -- truncated reason on last failed sync (cleared on next ok)
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fathom_connections
  DROP CONSTRAINT IF EXISTS fathom_connections_last_sync_status_check;
ALTER TABLE public.fathom_connections
  ADD CONSTRAINT fathom_connections_last_sync_status_check
  CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok', 'error', 'in_progress'));

-- ─── 2) fathom_calls ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fathom_calls (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fathom_call_id    text        NOT NULL,              -- Fathom's external id, text because id format is unverified
  title             text,
  recording_url     text,
  transcript_url    text,
  duration_seconds  integer,
  call_date         timestamptz,
  sync_status       text        NOT NULL DEFAULT 'pending',  -- 'pending' | 'processed' | 'error' (Phase 2 worker advances 'pending' → 'processed')
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fathom_calls_unique_event UNIQUE (user_id, fathom_call_id)
);

ALTER TABLE public.fathom_calls
  DROP CONSTRAINT IF EXISTS fathom_calls_sync_status_check;
ALTER TABLE public.fathom_calls
  ADD CONSTRAINT fathom_calls_sync_status_check
  CHECK (sync_status IN ('pending', 'processed', 'error'));

CREATE INDEX IF NOT EXISTS fathom_calls_user_date_idx
  ON public.fathom_calls (user_id, call_date DESC);

CREATE INDEX IF NOT EXISTS fathom_calls_user_status_idx
  ON public.fathom_calls (user_id, sync_status);

-- ─── 3) RLS + scoped SELECT policies ────────────────────────────────────────
ALTER TABLE public.fathom_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fathom_calls       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fathom_connections_select_scoped" ON public.fathom_connections;
CREATE POLICY "fathom_connections_select_scoped"
  ON public.fathom_connections FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'admin' AND user_id IN (
      SELECT user_id FROM public.user_profiles WHERE managed_by = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "fathom_calls_select_scoped" ON public.fathom_calls;
CREATE POLICY "fathom_calls_select_scoped"
  ON public.fathom_calls FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'owner'
    OR (public.current_user_role() = 'admin' AND user_id IN (
      SELECT user_id FROM public.user_profiles WHERE managed_by = auth.uid()
    ))
  );

-- Retention: both tables cascade-delete via auth.users(id). No separate
-- prune function — Fathom data lives as long as the user does.
