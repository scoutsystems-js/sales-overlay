-- Migration 006: knowledge_base user scoping for v1.1.x KB upload feature
--
-- Adds three columns to knowledge_base:
--   uploaded_by   UUID  — user_id of the uploader. NULL means a
--                         system/seeded entry (the original 65+
--                         framework rows from scripts/seed-frameworks.js
--                         all keep NULL here, so they remain visible
--                         to every caller via the IS NULL branch in
--                         match_knowledge below).
--   scope         TEXT  — visibility scope: 'global', 'team',
--                         'personal'. NULL is treated as global so
--                         pre-existing seeded rows behave unchanged.
--   source_label  TEXT  — human-readable name for the source (URL,
--                         filename, or user-provided title). Used by
--                         the dashboard to group chunks back into
--                         "one upload" and to drive the DELETE route.
--
-- Also updates the match_knowledge RPC to accept two new optional
-- parameters at the END of the parameter list:
--   p_user_id   UUID DEFAULT NULL
--   p_admin_id  UUID DEFAULT NULL
-- The new WHERE clause keeps a row if ANY are true:
--   - uploaded_by IS NULL          (seeded system entries)
--   - scope = 'global'             (explicitly global uploads)
--   - scope = 'personal' AND uploaded_by = p_user_id
--   - scope = 'team'     AND uploaded_by = p_admin_id
-- Existing callers passing no user params still get all global +
-- seeded entries (the personal/team branches just never match because
-- the params are NULL). Return columns are unchanged so the desktop
-- KB client doesn't need a code change to remain compatible.
--
-- No new RLS policies needed — knowledge_base reads route through the
-- backend service-role client (in routes/kb.js), and the backend
-- enforces the scope filter at RPC call time.
--
-- Additive only. Safe to re-run.

ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS uploaded_by  UUID,
  ADD COLUMN IF NOT EXISTS scope        TEXT,
  ADD COLUMN IF NOT EXISTS source_label TEXT;

-- Drop the old function before recreating with the new signature.
-- Postgres treats functions with different param lists as distinct,
-- so we drop by full signature to avoid accumulating overloaded versions.
DROP FUNCTION IF EXISTS match_knowledge(vector, double precision, integer);
DROP FUNCTION IF EXISTS match_knowledge(vector, double precision, integer, uuid, uuid);

CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding  vector,
  match_threshold  double precision DEFAULT 0.7,
  match_count      integer          DEFAULT 5,
  p_user_id        uuid             DEFAULT NULL,
  p_admin_id       uuid             DEFAULT NULL
)
RETURNS TABLE (
  id         uuid,
  category   text,
  label      text,
  content    text,
  triggers   text[],
  metadata   jsonb,
  similarity double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kb.id,
    kb.category,
    kb.label,
    kb.content,
    kb.triggers,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE kb.embedding IS NOT NULL
    AND 1 - (kb.embedding <=> query_embedding) > match_threshold
    AND (
      kb.uploaded_by IS NULL
      OR kb.scope = 'global'
      OR (kb.scope = 'personal' AND kb.uploaded_by = p_user_id)
      OR (kb.scope = 'team'     AND kb.uploaded_by = p_admin_id)
    )
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;
