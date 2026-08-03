-- Migration 029: knowledge_base.team_owner_id — the explicit team key that
-- makes PROMOTION possible (KB Part 2, sub-stage 2a).
--
-- ── Why ───────────────────────────────────────────────────────────────────
-- Migration 006 made a team row mean "scope='team' AND uploaded_by = the
-- manager". That conflates two different things — WHO CREATED the material
-- (provenance) and WHICH TEAM it belongs to (visibility). The consequence:
-- promoting a REP's entry to team scope was impossible. Flipping its `scope`
-- to 'team' left uploaded_by pointing at the rep, so match_knowledge matched
-- it for NOBODY (the branch demanded uploaded_by BE the manager). The only
-- workaround was rewriting uploaded_by to the manager, which permanently
-- destroys "this came from Ava's Mar-14 call" — exactly the attribution the
-- Part 2 promotion button needs.
--
-- team_owner_id separates them:
--   uploaded_by    → provenance. NEVER rewritten. Who created the row.
--   team_owner_id  → visibility. The manager/owner whose team sees it.
--
-- ── Backward compatibility ────────────────────────────────────────────────
-- The new team branch reads COALESCE(team_owner_id, uploaded_by), so a row
-- written before this migration keeps its EXACT previous meaning with no
-- backfill required. The backfill below is belt-and-braces for rows that
-- already carry scope='team'.
--
-- Live count at time of writing: ZERO rows have scope='team' (verified — the
-- org has 3 owners + 5 users and no managers, so every upload has landed
-- 'global' via the owner→global mapping). The backfill is therefore a no-op
-- today; it exists so the migration is correct if run against a database
-- where team rows DO exist.
--
-- Additive only. Safe to re-run.

ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS team_owner_id uuid;

COMMENT ON COLUMN public.knowledge_base.team_owner_id IS
  'Team key for scope=''team'' rows: the manager/owner whose team may read this row. Distinct from uploaded_by, which stays true provenance so promoted material keeps its attribution. NULL falls back to uploaded_by (pre-029 rows).';

-- Belt-and-braces backfill: make the implicit old rule explicit for any
-- pre-existing team rows. No-op on the current database (0 such rows).
UPDATE public.knowledge_base
   SET team_owner_id = uploaded_by
 WHERE scope = 'team'
   AND team_owner_id IS NULL
   AND uploaded_by IS NOT NULL;

-- Partial index: team reads always filter on this column, and only team rows
-- ever carry it, so keep the index off the other ~700 rows.
CREATE INDEX IF NOT EXISTS knowledge_base_team_owner_idx
  ON public.knowledge_base (team_owner_id)
  WHERE scope = 'team';

-- ── match_knowledge: the team branch now keys on team_owner_id ────────────
-- The WHERE clause below is mirrored by KB_VISIBILITY_SQL in lib/kb-scope.js
-- and pinned by test/kb-scope-sql-mirror.test.js, which (a) asserts this file
-- contains that exact clause text and (b) evaluates the clause against the
-- same fixtures as the JS predicate. Edit BOTH or the suite fails.
--
-- Signature and return columns are UNCHANGED from 006 — no caller needs a
-- code change, and the p_user_id/p_admin_id defaults still make an
-- unparameterised call return exactly the seeded + global set.
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
      OR (kb.scope = 'team'     AND COALESCE(kb.team_owner_id, kb.uploaded_by) = p_admin_id)
    )
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;
