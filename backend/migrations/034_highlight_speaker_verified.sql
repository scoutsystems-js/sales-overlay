-- 034 — record whether a highlight's CLOSER/PROSPECT label is PROVEN or GUESSED.
--
-- Until 6a, every speaker label in the system was inferred by the model from
-- conversational cues, because the pipeline hardcoded recorded_by=null and never
-- looked at the per-turn invitee email. Measured on the corpus with a sound
-- locator: 13 of 439 verifiable highlights (3%) carry the WRONG speaker, and the
-- intro section is worst at 19%. Nothing recorded that any of it was a guess.
--
-- NULLABLE with no default, deliberately. Three distinct states must stay
-- distinguishable and a default would collapse two of them:
--   NULL  — never assessed (legacy rows, and rows whose call has no closer
--           identity at all, e.g. demo users — unfixable by any method)
--   false — assessed and NOT provable (quote not reconstructible from the
--           stored turns, or two speakers could have said it). The label is
--           the model's guess and must not be presented as established.
--   true  — the quote was reconstructed from consecutive transcript turns and
--           the speaker is proven.
--
-- Consumers: closer-side features must filter on speaker_verified = true rather
-- than trusting `speaker`. See lib/kb-entry.js metadata.speaker_verified for the
-- same distinction on harvested knowledge-base moments.

alter table public.call_highlights
  add column if not exists speaker_verified boolean;

comment on column public.call_highlights.speaker_verified is
  'NULL = never assessed; false = assessed, speaker not provable (label is a model guess); true = speaker proven from transcript turns. Closer-side features must require true.';

create index if not exists call_highlights_speaker_verified_idx
  on public.call_highlights (user_id, speaker_verified)
  where speaker_verified is true;
