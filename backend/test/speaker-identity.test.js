/**
 * 6a — deterministic speaker labelling.
 *
 * Settled by live Fathom fetch (2026-08-11): only the recorded_by user's turns
 * carry `speaker.matched_calendar_invitee_email`, and the value equals
 * `fathom_connections.fathom_email` exactly. Measured across three real calls:
 * closer 47/47, 551/551, 653/653 WITH the email; prospects 0/180 and 0/257.
 * Presence/absence is therefore a PERFECT discriminator.
 *
 * RULING: exact email equality only. No name fallback, no talk-time heuristic,
 * no fuzzy matching. When the signal is absent we label UNKNOWN and let the
 * model infer — but we RECORD that it was inferred, so no downstream surface
 * can present a guess as the closer's own material.
 *
 * RULING 1: the email is resolved to CLOSER/PROSPECT at normalize time and
 * DISCARDED. It is never written into transcript_stored — storing a personal
 * email on every turn would spread PII for no downstream gain.
 */
const test = require('node:test');
const assert = require('node:assert');

const { normalizeTranscript } = require('../lib/transcript-normalizer');
const { buildMomentRow } = require('../lib/kb-entry');

const CLOSER_EMAIL = 'joshua@soberlivingriches.com';

function turn(name, email, text, ts) {
  const speaker = { display_name: name };
  if (email) speaker.matched_calendar_invitee_email = email;
  return { speaker: speaker, text: text, timestamp: ts || '00:00:01' };
}

function meetingWith(turns, closerEmail) {
  return { transcript: turns, highlights: [], recorded_by: null, closer_email: closerEmail };
}

test('exact email equality labels CLOSER and PROSPECT', () => {
  const out = normalizeTranscript(meetingWith([
    turn('Joshua Pinner', CLOSER_EMAIL, 'This meeting is being recorded.'),
    turn('Leonard', null, 'Sounds good.'),
    turn('Joshua Pinner', CLOSER_EMAIL, 'Tell me where you are today.'),
  ], CLOSER_EMAIL));

  assert.strictEqual(out.speaker_confidence, 'matched');
  assert.strictEqual(out.closer_name, 'Joshua Pinner');
  assert.deepStrictEqual(out.turns.map(t => t.speaker), ['CLOSER', 'PROSPECT', 'CLOSER']);
});

test('RULING 1, amended 2026-09-03 (H700) — the email is never on a TURN; it appears once per speaker in speaker_identities', () => {
  const out = normalizeTranscript(meetingWith([
    turn('Joshua Pinner', CLOSER_EMAIL, 'Hello.'),
    turn('Leonard', null, 'Hi.'),
  ], CLOSER_EMAIL));

  /* `turns` is what transcript_stored persists — the PII reasoning of RULING 1
     stands there. The per-call, per-speaker store is Justin's ruling, so the
     email must appear EXACTLY ONCE in the whole output: on its speaker's entry. */
  const serialized = JSON.stringify(out);
  assert.strictEqual(serialized.split(CLOSER_EMAIL).length - 1, 1,
    'closer email appears exactly once — on speaker_identities, never on a turn');
  assert.ok(JSON.stringify(out.turns).indexOf(CLOSER_EMAIL) === -1, 'never on a turn (transcript_stored)');
  assert.deepStrictEqual(out.speaker_identities, [
    { display_name: 'Joshua Pinner', email: CLOSER_EMAIL, turns: 1 },
    { display_name: 'Leonard', email: null, turns: 1 },
  ]);
  out.turns.forEach(t => {
    assert.strictEqual(t.matched_calendar_invitee_email, undefined);
    assert.strictEqual(t.email, undefined);
  });
});

test('email comparison ignores case and surrounding whitespace', () => {
  const out = normalizeTranscript(meetingWith([
    turn('Joshua Pinner', '  JOSHUA@SoberLivingRiches.com ', 'Hello.'),
    turn('Leonard', null, 'Hi.'),
  ], CLOSER_EMAIL));

  assert.strictEqual(out.speaker_confidence, 'matched');
  assert.deepStrictEqual(out.turns.map(t => t.speaker), ['CLOSER', 'PROSPECT']);
});

test('the SAME closer under two diarized display names is CLOSER on both', () => {
  // Fathom occasionally splits one speaker across display names; the email is
  // what makes this survivable, and is why we key on it rather than the name.
  const out = normalizeTranscript(meetingWith([
    turn('Joshua Pinner', CLOSER_EMAIL, 'Hello.'),
    turn('Josh Pinner', CLOSER_EMAIL, 'Still me.'),
    turn('Leonard', null, 'Hi.'),
  ], CLOSER_EMAIL));

  assert.deepStrictEqual(out.turns.map(t => t.speaker), ['CLOSER', 'CLOSER', 'PROSPECT']);
});

test('two people named Joshua — the email arbitrates, the name cannot', () => {
  // Real call: "PS Sober Living Riches | Joshua Arz". The prospect is diarized
  // "Josh" (1214 turns, no email); the closer is "Joshua Pinner" (549/549 with
  // the email). Any name heuristic is ambiguous here; equality is not.
  const out = normalizeTranscript(meetingWith([
    turn('Josh', null, 'The total price to work with us was $9,800.'),
    turn('Joshua Pinner', CLOSER_EMAIL, 'Got it.'),
  ], CLOSER_EMAIL));

  assert.deepStrictEqual(out.turns.map(t => t.speaker), ['PROSPECT', 'CLOSER']);
  assert.strictEqual(out.closer_name, 'Joshua Pinner');
});

test('no connection email → UNKNOWN, raw display names, never a guess', () => {
  const out = normalizeTranscript(meetingWith([
    turn('Joshua Pinner', CLOSER_EMAIL, 'Hello.'),
    turn('Leonard', null, 'Hi.'),
  ], null));

  assert.strictEqual(out.speaker_confidence, 'unknown');
  assert.strictEqual(out.closer_name, null);
  assert.deepStrictEqual(out.turns.map(t => t.speaker), ['Joshua Pinner', 'Leonard']);
});

test('emails present but NONE match the connection → UNKNOWN, not a guess', () => {
  // A different workspace member recorded the call. Labelling anyone CLOSER
  // here would be exactly the fabrication the governing principle forbids.
  const out = normalizeTranscript(meetingWith([
    turn('Someone Else', 'other@soberlivingriches.com', 'Hello.'),
    turn('Leonard', null, 'Hi.'),
  ], CLOSER_EMAIL));

  assert.strictEqual(out.speaker_confidence, 'unknown');
  assert.strictEqual(out.closer_name, null);
});

test('no name fallback — a matching recorded_by name does NOT produce a match', () => {
  // The old fuzzy path would have matched "Joshua" against "Joshua Pinner".
  // Ruling: email equality is the ONLY discriminator the pipeline uses.
  const out = normalizeTranscript({
    transcript: [turn('Joshua Pinner', null, 'Hello.'), turn('Leonard', null, 'Hi.')],
    highlights: [],
    recorded_by: null,
    closer_email: CLOSER_EMAIL,
  });

  assert.strictEqual(out.speaker_confidence, 'unknown');
});

test('Zoom (no per-turn emails at all) degrades to UNKNOWN unchanged', () => {
  const out = normalizeTranscript(meetingWith([
    turn('Joshua Pinner', null, 'Hello.'),
    turn('Guest', null, 'Hi.'),
  ], CLOSER_EMAIL));

  assert.strictEqual(out.speaker_confidence, 'unknown');
  assert.deepStrictEqual(out.turns.map(t => t.speaker), ['Joshua Pinner', 'Guest']);
});

test('INVARIANT: closer_name non-null ⟺ speaker_confidence matched', () => {
  // `speaker_confidence` is not persisted — only `speaker_closer_name` is. The
  // manual Add-to-KB path therefore infers "was this matched?" from the name
  // being non-null. That is only safe while the two move together, so pin it.
  const matched = normalizeTranscript(meetingWith([
    turn('Joshua Pinner', CLOSER_EMAIL, 'Hello.'), turn('Leonard', null, 'Hi.'),
  ], CLOSER_EMAIL));
  const unknown = normalizeTranscript(meetingWith([
    turn('Joshua Pinner', CLOSER_EMAIL, 'Hello.'), turn('Leonard', null, 'Hi.'),
  ], null));
  const empty = normalizeTranscript(null);

  [matched, unknown, empty].forEach(o => {
    assert.strictEqual(o.closer_name !== null, o.speaker_confidence === 'matched',
      'closer_name presence must track speaker_confidence exactly');
  });
});

// ─── downstream: a guessed speaker must never be filed as verified ──────────

function momentRow(speakerConfidence) {
  return buildMomentRow({
    highlight: { section: 'close', speaker: 'CLOSER', quote: 'I got you.', observation: 'x', type: 'strong_moment' },
    target: { uploaded_by: 'u1', scope: 'personal', team_owner_id: null },
    fathomCallId: 'c1',
    source: 'auto_closed_call',
    speakerConfidence: speakerConfidence,
  });
}

test('harvested moment from a MATCHED call is marked speaker_verified true', () => {
  assert.strictEqual(momentRow('matched').metadata.speaker_verified, true);
});

test('harvested moment from an UNKNOWN call is marked speaker_verified false', () => {
  // This is the 6b failure repeated forward: an inferred CLOSER label filed as
  // the rep's own winning material, with nothing recording that it was a guess.
  assert.strictEqual(momentRow('unknown').metadata.speaker_verified, false);
});

test("an UNPROVEN highlight on a MATCHED call is not stamped verified", () => {
  // A call can be matched overall while one quote is paraphrased and therefore
  // not reconstructible. The moment's own verdict must win over its neighbours'.
  const row = buildMomentRow({
    highlight: { section: 'close', speaker: 'CLOSER', quote: 'q', observation: 'o', speaker_verified: false },
    target: { uploaded_by: 'u1', scope: 'personal', team_owner_id: null },
    fathomCallId: 'c1', source: 'auto_closed_call', speakerConfidence: 'matched',
  });
  assert.strictEqual(row.metadata.speaker_verified, false);
});

test('a PROVEN highlight is stamped verified even without call-level confidence', () => {
  const row = buildMomentRow({
    highlight: { section: 'close', speaker: 'CLOSER', quote: 'q', observation: 'o', speaker_verified: true },
    target: { uploaded_by: 'u1', scope: 'personal', team_owner_id: null },
    fathomCallId: 'c1', source: 'manual_add',
  });
  assert.strictEqual(row.metadata.speaker_verified, true);
});

test('absent speakerConfidence is treated as unverified, not verified', () => {
  const row = buildMomentRow({
    highlight: { section: 'close', speaker: 'CLOSER', quote: 'q', observation: 'o' },
    target: { uploaded_by: 'u1', scope: 'personal', team_owner_id: null },
    fathomCallId: 'c1',
    source: 'manual_add',
  });
  assert.strictEqual(row.metadata.speaker_verified, false);
});
