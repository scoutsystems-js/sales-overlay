-- 035 — is a highlight's `closer_response` really the CLOSER's words?
--
-- An objection is stored as the PROSPECT's row with the closer's handling line
-- in the `closer_response` FIELD, so the rep's objection work is invisible to
-- any CLOSER-speaker filter: 257 rows carry a response, against 1 usable
-- objection moment on screen.
--
-- But closer_response is MODEL-QUOTED text that was never located in a
-- transcript, and the field name is not evidence. Measured with lib/quote-locate:
-- of 53 responses that reconstruct, 3 were actually spoken by the PROSPECT
-- (~6%). Surfacing the field on the strength of its name would have shown a rep
-- the prospect's words as their own objection handling — the exact failure 6b
-- had to repair in the knowledge base.
--
-- Three-valued, matching call_highlights.speaker_verified (migration 034):
--   NULL  — never assessed (no closer identity for that call, or no response)
--   false — assessed and NOT usable: either the quote could not be
--           reconstructed from consecutive turns, or it reconstructed to
--           someone who is not the closer. Both mean "do not attribute this to
--           the rep"; the consumer's question is only ever "is this theirs?"
--   true  — reconstructed from the transcript AND spoken by the closer
--
-- Consumers must require true. See lib/quote-locate.js for the attribution
-- contract (full reconstruction, refuse on ambiguity, never a substring match).

alter table public.call_highlights
  add column if not exists closer_response_verified boolean;

comment on column public.call_highlights.closer_response_verified is
  'NULL = never assessed; false = not reconstructible OR reconstructed to someone other than the closer; true = proven the closer''s words. Required true before showing closer_response as the rep''s own line.';

create index if not exists call_highlights_closer_response_verified_idx
  on public.call_highlights (user_id, closer_response_verified)
  where closer_response_verified is true;
