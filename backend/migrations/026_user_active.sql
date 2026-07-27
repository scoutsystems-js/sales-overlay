-- Migration 026: user deactivation (User Management block, 2026-07-27).
--
-- A deactivated user can't log in and doesn't count as a billable seat, but
-- their calls / grades / history stay in period data and team rosters (nothing
-- filters on status except the seat count and /fathom/sync-all). Deactivation is
-- Supabase ban (blocks new login + refresh) PLUS this app-level flag, which the
-- requireAuth middleware checks so a still-valid access token is rejected
-- immediately (empirically: ban alone does NOT reject an existing access token,
-- and supabase-js can't revoke sessions by user id — so the flag is the enforcer).
--
-- Additive + safe: every existing row defaults to active.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS user_profiles_active_idx ON public.user_profiles (active);
