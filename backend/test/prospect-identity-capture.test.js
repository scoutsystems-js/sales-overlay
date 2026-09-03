/**
 * THE PROSPECT-NAME LIFT, step 1 (Justin's ruling 2026-09-03): STORE THE EXACT
 * IDENTITY THAT IS ALREADY ARRIVING. Store, do not resolve — no regrouping, no
 * merging, no renaming, no rate moves. New calls only.
 *
 * Three captures, each a column on fathom_calls (migration 062):
 *   • calendar_invitees   — the meeting's invitee list, at SYNC (meetingToRow).
 *                           NULL = the field was not received (pre-062 row, Zoom);
 *                           []   = received and empty. "Write the null" (H094).
 *   • speaker_identities  — one entry PER SPEAKER from the transcript's
 *                           matched_calendar_invitee_email, at ANALYSIS. Once per
 *                           call, never per turn: RULING 1 (2026-08-11) kept the
 *                           email off every transcript row to avoid spreading PII;
 *                           that reasoning stands, and the per-call store is the
 *                           amendment Justin ruled, not a reversal of it.
 *   • title_name_segment  — the title's last "|" segment, verbatim. A SEGMENT,
 *                           not a name: nothing may overrule anything on it yet.
 *
 * ⚠ The 2026-08-11 measurement (three calls) found the per-turn email on the
 * CLOSER's turns only — prospects 0/437. If that holds corpus-wide, the invitee
 * LIST is the carrier of the prospect's identity and speaker_identities will show
 * one email per call. Storing both IS the measurement.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');

const pi = require('../lib/prospect-identity');
const { normalizeTranscript } = require('../lib/transcript-normalizer');
const fathomRouter = require('../routes/fathom');

const CLOSER = 'joshua@soberlivingriches.com';
const PROSPECT = 'Leonard.Cole@gmail.com';

function turn(name, email, text) {
  const speaker = { display_name: name };
  if (email) speaker.matched_calendar_invitee_email = email;
  return { speaker, text, timestamp: '00:00:01' };
}

/* ── 1 · the invitee list, at sync ─────────────────────────────────────────── */
test('inviteesFromMeeting: null when the field was not received, [] when empty, entries need an email', () => {
  assert.strictEqual(pi.inviteesFromMeeting({}), null, 'absent field → null (not received)');
  assert.strictEqual(pi.inviteesFromMeeting({ calendar_invitees: 'nope' }), null);
  assert.deepStrictEqual(pi.inviteesFromMeeting({ calendar_invitees: [] }), []);
  const out = pi.inviteesFromMeeting({ calendar_invitees: [
    { name: 'Leonard Cole', email: ' Leonard.Cole@gmail.com ', email_domain: 'gmail.com', is_external: true, matched_speaker_display_name: 'Leonard' },
    { name: 'Joshua Pinner', email: CLOSER, is_external: false },
    { name: 'no email here' },
    'garbage',
  ] });
  assert.deepStrictEqual(out, [
    { name: 'Leonard Cole', email: 'leonard.cole@gmail.com', email_domain: 'gmail.com', is_external: true, matched_speaker_display_name: 'Leonard' },
    { name: 'Joshua Pinner', email: CLOSER, email_domain: null, is_external: false, matched_speaker_display_name: null },
  ]);
});

test('meetingToRow (EXECUTED) carries calendar_invitees and title_name_segment onto the row', () => {
  const row = fathomRouter._meetingToRow('user-1', {
    recording_id: 123, meeting_title: 'PS Sober Living Riches | Manuel Torres',
    recording_start_time: '2026-09-03T15:00:00Z', recording_end_time: '2026-09-03T16:00:00Z',
    calendar_invitees: [{ name: 'Manuel Torres', email: 'MT@example.com', is_external: true }],
  });
  assert.deepStrictEqual(row.calendar_invitees, [{ name: 'Manuel Torres', email: 'mt@example.com', email_domain: null, is_external: true, matched_speaker_display_name: null }]);
  assert.strictEqual(row.title_name_segment, 'Manuel Torres');
  const bare = fathomRouter._meetingToRow('user-1', { recording_id: 124, title: 'Impromptu Zoom Meeting' });
  assert.strictEqual(bare.calendar_invitees, null, 'not received → null, never []');
  assert.strictEqual(bare.title_name_segment, null, 'no "|" → nothing captured');
});

/* ── 2 · the title segment: a segment, structurally checked, never resolved ── */
test('titleNameSegment: last "|" segment, 2–4 tokens, no digits/emails, rejection vocabulary applied', () => {
  assert.strictEqual(pi.titleNameSegment('PS Sober Living Riches | Manuel Torres'), 'Manuel Torres');
  assert.strictEqual(pi.titleNameSegment('IH - Sober Living Riches | Anthony  Ehikhamhen '), 'Anthony Ehikhamhen');
  assert.strictEqual(pi.titleNameSegment('Sober Living Riches | Keen-Yah E. Bostic'), 'Keen-Yah E. Bostic');
  assert.strictEqual(pi.titleNameSegment('Check up With Dre | Sober Living Riches'), 'Sober Living Riches',
    'a company name in the slot is STORED verbatim — it is a segment, and the coverage report is where it is judged');
  assert.strictEqual(pi.titleNameSegment('Impromptu Zoom Meeting'), null, 'unpiped → null');
  assert.strictEqual(pi.titleNameSegment('Sober Living Riches | Manuel'), null, 'one token is not a surname');
  assert.strictEqual(pi.titleNameSegment('Sober Living Riches | 555 123 4567'), null, 'digits');
  assert.strictEqual(pi.titleNameSegment('Sober Living Riches | mt@example.com'), null, 'an email is not a name segment');
  assert.strictEqual(pi.titleNameSegment("Sober Living Riches | Margaret's iPhone"), null, 'device vocabulary rejected');
  assert.strictEqual(pi.titleNameSegment(null), null);
});

/* ── 3 · per-speaker identities from the transcript, once per call ─────────── */
test('normalizeTranscript exposes speaker_identities once per speaker, and turns stay email-free (RULING 1)', () => {
  const out = normalizeTranscript({ transcript: [
    turn('Joshua Pinner', CLOSER, 'This meeting is being recorded.'),
    turn('Leonard', PROSPECT, 'Sounds good.'),
    turn('Joshua Pinner', CLOSER, 'Tell me where you are today.'),
    turn('Leonard', PROSPECT, 'Okay.'),
    turn('Brittany', null, 'Hi, I am here too.'),
  ], highlights: [], recorded_by: null, closer_email: CLOSER });
  assert.deepStrictEqual(out.speaker_identities, [
    { display_name: 'Joshua Pinner', email: CLOSER, turns: 2 },
    { display_name: 'Leonard', email: PROSPECT.toLowerCase(), turns: 2 },
    { display_name: 'Brittany', email: null, turns: 1 },
  ]);
  out.turns.forEach(t => {
    assert.strictEqual(t.email, undefined);
    assert.strictEqual(t.matched_calendar_invitee_email, undefined);
  });
  assert.ok(JSON.stringify(out.turns).indexOf('@') === -1, 'no email on any turn');
});

test('speaker_identities is [] on a transcript with no usable turns', () => {
  assert.deepStrictEqual(normalizeTranscript({ transcript: [] }).speaker_identities, []);
  assert.deepStrictEqual(normalizeTranscript(null).speaker_identities, []);
});

/* ── 4 · the store, executed against a fake admin ──────────────────────────── */
test('storeCallIdentities (EXECUTED) updates fathom_calls scoped by id AND user_id, and never throws', async () => {
  const calls = [];
  const admin = { from(table) { return {
    update(patch) { return { eq(k1, v1) { return { eq(k2, v2) {
      calls.push({ table, patch, filters: [[k1, v1], [k2, v2]] });
      return Promise.resolve({ error: null });
    } }; } }; } }; } };
  await pi.storeCallIdentities(admin, 'call-uuid', 'user-1', { speaker_identities: [{ display_name: 'Leonard', email: PROSPECT.toLowerCase(), turns: 2 }] });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].table, 'fathom_calls');
  assert.deepStrictEqual(calls[0].filters, [['id', 'call-uuid'], ['user_id', 'user-1']]);
  assert.deepStrictEqual(Object.keys(calls[0].patch), ['speaker_identities']);
  const bad = { from() { return { update() { return { eq() { return { eq() { return Promise.resolve({ error: { message: 'boom' } }); } }; } }; } }; } };
  await assert.doesNotReject(() => pi.storeCallIdentities(bad, 'c', 'u', { speaker_identities: [] }));
  const thrower = { from() { throw new Error('down'); } };
  await assert.doesNotReject(() => pi.storeCallIdentities(thrower, 'c', 'u', { speaker_identities: [] }));
});

/* ── 5 · the worker call site: Fathom only, after normalize, before any model call ── */
test('analysis-worker stores speaker_identities right after normalizeTranscript, and not on Zoom', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8'));
  const norm = src.indexOf('var normalized = normalizeTranscript(meeting);');
  assert.ok(norm !== -1, 'normalize call site moved');
  const store = src.indexOf('storeCallIdentities(admin, fathomCallId, userId, { speaker_identities: normalized.speaker_identities })', norm);
  assert.ok(store !== -1 && store - norm < 900, 'store call must follow the normalize call within the same block; got ' + (store - norm));
  const between = src.slice(norm, store);
  assert.ok(/transcriptSourceFor\(callRow\) !== 'zoom'/.test(between), 'the store is gated to Fathom — Zoom VTTs carry no emails, so the column stays NULL (not captured), never []');
  const grader = src.indexOf('getAnthropic()', norm);
  assert.ok(grader === -1 || store < grader, 'stored before any model call — identity is captured even if grading fails');
});

/* ── 6 · migration 062 declares the three columns with the null semantics ──── */
test('migration 062 adds the three columns on fathom_calls', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '062_prospect_identity_capture.sql'), 'utf8');
  ['calendar_invitees jsonb', 'speaker_identities jsonb', 'title_name_segment text'].forEach(col => {
    assert.ok(new RegExp('ALTER TABLE fathom_calls ADD COLUMN IF NOT EXISTS ' + col).test(sql), 'missing: ' + col);
  });
  assert.ok(/NULL = not (received|captured)/.test(sql), 'the null semantics are declared in the migration');
});
