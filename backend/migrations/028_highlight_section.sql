-- Migration 028: call_highlights.section — which call section a highlight belongs to.
--
-- Part of Call Review Context (Part 1a). The highlight extractor now tags each
-- moment with the section it happened in, so the Call Review page can break a
-- section's score down into that section's own good/bad highlights (Part 1b UI).
--
-- NULLABLE on purpose: highlights extracted before this change — and any analyses
-- older than the 30-day backfill window — legitimately have no section. The review
-- UI falls back to the existing section-notes prose for those (no empty/broken
-- state). New analyses (and the 30-day backfill) populate it.
--
-- CHECK allows NULL or exactly one of the five sections (mirrors
-- VALID_HIGHLIGHT_SECTIONS in lib/highlight-section.js).

ALTER TABLE public.call_highlights
  ADD COLUMN IF NOT EXISTS section text;

ALTER TABLE public.call_highlights
  DROP CONSTRAINT IF EXISTS call_highlights_section_check;
ALTER TABLE public.call_highlights
  ADD CONSTRAINT call_highlights_section_check
  CHECK (section IS NULL OR section IN ('intro', 'discovery', 'pitch', 'objection', 'close'));
