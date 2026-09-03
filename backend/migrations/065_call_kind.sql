-- THE FOLLOW-UP FLAG (Justin's ruling 2026-09-03, H706): the missing third state —
-- booked · follow-up · not-a-sales-call. A follow-up IS a sales call (counts in calls
-- taken, its coaching and moments stand); it is NOT a booked call — its outcome
-- attributes to the booked call it follows (follows_call_id).
-- call_kind_source: 'linked' (a linked later call for the prospect) | 'first' (no link,
-- no earlier call → booked) | 'human' (set by hand on the Calls page).
-- A human mark ALWAYS wins and is never reversed by a re-analysis (call_kind_marked_by).
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS call_kind text CHECK (call_kind IS NULL OR call_kind IN ('booked','follow_up'));
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS call_kind_source text CHECK (call_kind_source IS NULL OR call_kind_source IN ('linked','first','human'));
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS call_kind_marked_by uuid;
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS call_kind_marked_at timestamptz;
ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS follows_call_id uuid REFERENCES fathom_calls(id) ON DELETE SET NULL;
COMMENT ON COLUMN fathom_calls.call_kind IS 'booked | follow_up; NULL = not yet decided (pre-065, or no prospect).';
COMMENT ON COLUMN fathom_calls.follows_call_id IS 'For a follow_up: the earliest booked call of the same prospect it attributes to; NULL when none is known (an unlinked human-marked follow-up).';
