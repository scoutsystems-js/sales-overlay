-- Migration 004: user script storage for v1.1.0
--
-- Adds two columns to user_profiles:
--   script_raw     TEXT  — the full script text the user
--                          uploaded or pasted (reference copy,
--                          never sent to Claude at call time)
--   script_summary TEXT  — AI-generated structured summary
--                          (~400-700 tokens) produced at upload
--                          time by /summarize-script. This is
--                          what the suggestion engine sees on
--                          every call via CallMemory.getContext().
--
-- No new RLS policies needed: existing user_profiles policies
-- already scope all reads and writes to auth.uid().
--
-- Additive only. Safe to re-run.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS script_raw     TEXT,
  ADD COLUMN IF NOT EXISTS script_summary TEXT;
