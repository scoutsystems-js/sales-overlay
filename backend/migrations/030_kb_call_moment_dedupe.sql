-- Migration 030: dedupe key for knowledge_base entries harvested from call
-- highlights (KB Part 2, sub-stage 2b — the "Add to Knowledge Base" button;
-- reused unchanged by 2d's auto-population).
--
-- ── The key ───────────────────────────────────────────────────────────────
--   (uploaded_by, source_fathom_call_id, source_section, source_quote_hash)
--
-- uploaded_by is the KB OWNER, so the same moment can legitimately exist once
-- in a rep's personal KB and once in the team KB (different owners, different
-- knowledge bases) without colliding — while a second add into the SAME KB is
-- refused. That is what makes the manual button and 2d's auto-population
-- idempotent against each other by construction: auto-population writes with
-- uploaded_by = the rep, and a rep manually adding the same moment produces an
-- identical key and hits this index.
--
-- ── Why NOT the highlight id ──────────────────────────────────────────────
-- persistHighlights (lib/analysis-worker.js) is insert-new-then-delete-old, so
-- EVERY re-analysis reissues fresh call_highlights.id values for the same
-- moments. An id-keyed unique index would look correct in review and silently
-- readmit a duplicate on the next re-grade. The quote hash is derived from
-- content, so it survives the re-grade cycle.
--
-- ── Why PARTIAL ───────────────────────────────────────────────────────────
-- source_quote_hash IS NULL for (a) every pre-existing knowledge_base row —
-- 770 of them — and (b) any harvested moment with a blank quote. A full unique
-- index would collapse all of those into one conflicting bucket. The partial
-- predicate confines the constraint to rows that actually carry a key.
--
-- Additive only. Safe to re-run. No backfill: no harvested rows exist yet.

ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS source_fathom_call_id uuid,
  ADD COLUMN IF NOT EXISTS source_section        text,
  ADD COLUMN IF NOT EXISTS source_quote_hash     text;

COMMENT ON COLUMN public.knowledge_base.source_quote_hash IS
  'sha1 of the normalized source quote (lib/kb-entry.js quoteHash). Part of the harvested-moment dedupe key. NULL for non-harvested rows, which opt out of the partial unique index.';

-- Section must match the five the highlight extractor emits (mirrors
-- VALID_HIGHLIGHT_SECTIONS in lib/highlight-section.js and the CHECK on
-- call_highlights.section from migration 028). NULL allowed: non-harvested rows.
ALTER TABLE public.knowledge_base
  DROP CONSTRAINT IF EXISTS knowledge_base_source_section_check;
ALTER TABLE public.knowledge_base
  ADD CONSTRAINT knowledge_base_source_section_check
  CHECK (source_section IS NULL OR source_section IN ('intro', 'discovery', 'pitch', 'objection', 'close'));

-- THE dedupe constraint. ON CONFLICT in routes/kb.js targets exactly this.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_base_call_moment_dedupe_idx
  ON public.knowledge_base (uploaded_by, source_fathom_call_id, source_section, source_quote_hash)
  WHERE source_quote_hash IS NOT NULL;

-- Lookup support for "which moments from this call are already saved?", which
-- the review page uses to render already-added rows in their saved state.
CREATE INDEX IF NOT EXISTS knowledge_base_source_call_idx
  ON public.knowledge_base (source_fathom_call_id)
  WHERE source_fathom_call_id IS NOT NULL;
