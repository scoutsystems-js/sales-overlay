-- 072 — DOCTRINE IS INVISIBLE INFRASTRUCTURE (Justin, 2026-09-05; H734).
--
-- Scout's doctrine (category 'doctrine', scope 'global', no uploader — H732) is how Scout thinks, not a
-- document a team reads. It already does not list on the Knowledge Base page (the list route selects
-- rows WITH an uploader). THE GAP WAS SEARCH: both arms of the visibility clause below admit it — a null
-- uploader and a global scope — so the search page's query could return doctrine text to a rep. Executed
-- 2026-09-05 with a doctrine row's own embedding as the probe: every role got it back.
--
-- The fix is ONE extra conjunct, before the visibility clause: the search never returns a doctrine row.
-- The visibility clause itself is UNCHANGED and still mirrors KB_VISIBILITY_SQL in lib/kb-scope.js; the
-- new conjunct mirrors KB_HIDDEN_FROM_SEARCH_SQL there and lib/kb-scope kbReadRowVisible refuses a
-- doctrine row first, so the keyword fallback path agrees with this one. The advice lanes read the
-- doctrine through lib/doctrine loadDoctrine (by category), which this does not touch — invisible to
-- users, never invisible to the lanes.
--
-- Signature and return columns unchanged from 006/029. Safe to re-run.
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
    AND kb.category IS DISTINCT FROM 'doctrine'
    AND (
      kb.uploaded_by IS NULL
      OR kb.scope = 'global'
      OR (kb.scope = 'personal' AND kb.uploaded_by = p_user_id)
      OR (kb.scope = 'team'     AND COALESCE(kb.team_owner_id, kb.uploaded_by) = p_admin_id)
    )
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;
