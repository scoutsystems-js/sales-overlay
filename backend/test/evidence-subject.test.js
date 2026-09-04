/**
 * NO UNEARNED QUOTES — THE EVIDENCE SUBJECT CHECK (H724, Justin's ruling 2026-09-04).
 * The live defect: "partner objections handled 5 of 177, surfaced too late" naming Nathan and
 * Nick — and the quote attached was a prospect saying they feel comfortable buying. It proved
 * nothing about partner objections. The rep binding passed because Nick was named; NOTHING
 * checked the quote was about the same SUBJECT. The moment's own type and category are stored,
 * so the check is exact and needs no model call: the lane declares each claim's subject, and a
 * cited moment whose stored type or category disagrees loses its quote. The claim stands.
 * A claim built on COUNTS needs no quote at all. Absent beats wrong.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const lane = require('../lib/team-synthesis.js');

const M = (o) => Object.assign({ id: 'm1', rep: "Nick O'Neal", quote: 'I feel comfortable buying, honestly', spoke: 'prospect', clip_url: null, call_id: 'c1', highlight_id: 'h1', section: 'close' }, o);

test('⚠⚠ the LIVE defect: a partner-objection claim may not cite a buying-signal moment', () => {
  const reason = lane._evidenceSubjectMismatch({ kind: 'objection', category: 'partner' }, M({ type: 'buying_signal' }));
  assert.ok(reason, 'must be dropped'); assert.match(reason, /buying_signal/);
  assert.strictEqual(lane._evidenceSubjectMismatch({ kind: 'objection', category: 'partner' }, M({ type: 'objection', objection_category: 'partner' })), null, 'a partner objection proves a partner-objection claim');
  assert.ok(lane._evidenceSubjectMismatch({ kind: 'objection', category: 'partner' }, M({ type: 'objection', objection_category: 'fear' })), 'a fear objection does not prove a partner claim');
  assert.strictEqual(lane._evidenceSubjectMismatch({ kind: 'objection', category: null }, M({ type: 'objection', objection_category: 'fear' })), null, 'a claim about objections in general accepts any objection');
});

test('every subject kind checks against the stored field; a count needs no quote; no declared subject drops the quote', () => {
  assert.strictEqual(lane._evidenceSubjectMismatch({ kind: 'buying_signal' }, M({ type: 'buying_signal' })), null);
  assert.ok(lane._evidenceSubjectMismatch({ kind: 'missed_opportunity' }, M({ type: 'strong_moment' })));
  assert.strictEqual(lane._evidenceSubjectMismatch({ kind: 'section', section: 'close' }, M({ type: 'objection', section: 'close' })), null);
  assert.ok(lane._evidenceSubjectMismatch({ kind: 'section', section: 'discovery' }, M({ type: 'objection', section: 'close' })));
  assert.ok(lane._evidenceSubjectMismatch({ kind: 'count' }, M({ type: 'objection' })), 'a claim built on counts stands alone — any quote is unearned');
  assert.ok(lane._evidenceSubjectMismatch(null, M({ type: 'objection' })), 'no declared subject: absent beats wrong');
  assert.ok(lane._evidenceSubjectMismatch({ kind: 'weather' }, M({ type: 'objection' })), 'an unknown kind cannot be checked: drop');
  assert.strictEqual(lane._evidenceSubjectMismatch({ kind: 'count' }, null), null, 'no evidence, nothing to drop');
});

test('⚠⚠ resolveInsights, EXECUTED: the quote is dropped and the claim and its counts stand; a matching subject keeps its quote', () => {
  const byId = { m1: M({ type: 'buying_signal' }), m2: M({ id: 'm2', type: 'objection', objection_category: 'partner', quote: 'I need to run it by my wife first', rep: 'Nathan Reyes', highlight_id: 'h2' }) };
  const out = lane._resolveInsights([
    { claim: 'Partner objections are handled 5 of 177 and surface too late, Nathan and Nick especially.', data: 'Handled 5 of 177.', evidence_id: 'm1', subject: { kind: 'objection', category: 'partner' } },
    { claim: 'Nathan lets the partner objection sit unisolated.', data: 'Three of four partner objections went unhandled.', evidence_id: 'm2', subject: { kind: 'objection', category: 'partner' } },
    { claim: 'Discovery is the weakest section at 58.', data: 'Discovery 58, pitch 64.', evidence_id: 'm1', subject: { kind: 'count' } },
  ], byId, ["Nick O'Neal", 'Nathan Reyes']);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].quote, null, 'the unearned quote is gone'); assert.match(out[0].claim, /Partner objections/); assert.strictEqual(out[0].data, 'Handled 5 of 177.');
  assert.strictEqual(out[1].quote, 'I need to run it by my wife first'); assert.strictEqual(out[1].rep, 'Nathan Reyes');
  assert.strictEqual(out[2].quote, null, 'a count claim carries no quote');
});

test('⚠ the lane asks for the subject, tags each candidate with its category and section, and moved its version', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
  assert.ok(/"subject":\s*\{"kind"/.test(src), 'the JSON shape declares a subject');
  assert.ok(/objection_category, section/.test(src) || /objection_category,\s*section/.test(src), 'category and section are SELECTED');
  assert.ok(/RECS_LANE_VERSION = 'v9-/.test(src), 'v9 — a payload change bumps the lane inside its cache key');
  assert.ok(/evidenceSubjectMismatch\(/.test(src.replace(/function evidenceSubjectMismatch\(/, '')), 'the check is CALLED');
});
