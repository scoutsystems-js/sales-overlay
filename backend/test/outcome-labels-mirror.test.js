/**
 * THE NAMING SPLIT (Justin, 2026-09-03, H709): the OUTCOME reads Closed · Open · Lost ·
 * No-show · DQ (follow_up → Open); the CALL TYPE takes the word: Booked · Follow-up ·
 * Not a sales call. The stored values do not change. ONE map, every surface, the way
 * the role labels were done — the page's copy is EXECUTED against the lib, every
 * render site goes through the map, the prompts are handed the label, and the type is
 * a TAG, not a button.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const lib = require('../lib/outcome-labels');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

function pageFns() {
  const a = LIVE.indexOf('var OUTCOME_LABELS = {'); assert.ok(a > -1, 'the mirror is missing');
  const b = LIVE.indexOf('var OUTCOME_OPTS = OUTCOME_ORDER.map', a); assert.ok(b > a, 'OUTCOME_OPTS must be derived from the map');
  return new Function(LIVE.slice(a, b) + '\n return { OUTCOME_LABELS, OUTCOME_ORDER, CALL_TYPE_LABELS, outcomeLabel, callTypeLabel };')();
}

test('the ruling: follow_up → Open as an outcome; the type takes Follow-up; stored values untouched', () => {
  assert.deepStrictEqual(lib.OUTCOME_LABELS, { closed: 'Closed', follow_up: 'Open', lost: 'Lost', no_show: 'No-show', disqualified: 'DQ' });
  assert.deepStrictEqual(lib.CALL_TYPE_LABELS, { booked: 'Booked', follow_up: 'Follow-up', not_sales: 'Not a sales call' });
  assert.strictEqual(lib.outcomeLabel('follow_up'), 'Open'); assert.strictEqual(lib.outcomeLabel('FOLLOW_UP'), 'Open'); assert.strictEqual(lib.outcomeLabel(null), 'Unknown');
  assert.strictEqual(lib.callTypeLabel('follow_up'), 'Follow-up'); assert.strictEqual(lib.callTypeLabel(null), 'Booked'); assert.strictEqual(lib.callTypeLabel('booked', true), 'Not a sales call');
});

test('⚠⚠ EXECUTED: the page\'s copy answers exactly as the lib for every outcome, every type, and garbage', () => {
  const pg = pageFns();
  assert.deepStrictEqual(pg.OUTCOME_LABELS, lib.OUTCOME_LABELS); assert.deepStrictEqual(pg.OUTCOME_ORDER, lib.OUTCOME_ORDER); assert.deepStrictEqual(pg.CALL_TYPE_LABELS, lib.CALL_TYPE_LABELS);
  ['closed', 'follow_up', 'lost', 'no_show', 'disqualified', 'FOLLOW_UP', 'ghost', '', null, undefined].forEach((o) => assert.strictEqual(pg.outcomeLabel(o), lib.outcomeLabel(o), 'differs on ' + JSON.stringify(o)));
  [['booked', false], ['follow_up', false], ['ghost', false], [null, false], ['follow_up', true]].forEach(([k, ns]) => assert.strictEqual(pg.callTypeLabel(k, ns), lib.callTypeLabel(k, ns)));
});

test('⚠ every outcome render site goes THROUGH the map — no outcome label literal survives on the page', () => {
  assert.ok(/function eodOutcomeLabel\(oc\) \{ return outcomeLabel\(oc\); \}/.test(LIVE), 'the EOD label function is the map');
  assert.ok(/OUTCOME_LABELS\[String\(f\.outcome\)\] \|\| String\(f\.outcome\)/.test(LIVE), 'the EOD chip goes through the map');
  assert.ok(/\(s\.follow_up \|\| 0\) \+ ' ' \+ OUTCOME_LABELS\.follow_up\.toLowerCase\(\)/.test(LIVE), 'the digest stat line reads the map');
  assert.ok(!/\['follow_up', 'Follow up'\]/.test(LIVE) && !/if \(oc === 'follow_up'\) return 'Follow-up'/.test(LIVE), 'the old literals are gone');
  /* the only "Follow-up"/"Follow up" left in page strings are the call TYPE map, the follow-up email section and the nav placeholder */
  const offenders = LIVE.split('\n').filter((l) => /'[^'\n]*Follow[ -][Uu]p[^'\n]*'|"[^"\n]*Follow[ -][Uu]p[^"\n]*"/.test(l))
    .filter((l) => !/CALL_TYPE_LABELS = \{|Follow-up Email|Follow Up Strategy/.test(l));
  assert.deepStrictEqual(offenders, [], 'an outcome label literal is back: ' + JSON.stringify(offenders));
});

test('⚠⚠ EXECUTED: the EOD day reads "N calls · N closed · N open · N lost" through the map, and the tone knows Open', () => {
  const pg = pageFns();
  const src = fnBody(LIVE, 'eodDaySummary') + '\n' + fnBody(LIVE, 'eodOutcomeTone');
  const fn = new Function('OUTCOME_LABELS', src + '\n return eodDaySummary;')(pg.OUTCOME_LABELS);
  const day = [{ fields: { outcome: 'Closed - PIF' } }, { fields: { outcome: 'closed' } }, { fields: { outcome: 'Closed - Payment plan' } },
    { fields: { outcome: 'Open' } }, { fields: { outcome: 'follow_up' } }, { fields: { outcome: 'Open' } }, { fields: { outcome: 'Open' } }, { fields: { outcome: 'Open' } },
    { fields: { outcome: 'Lost' } }, { fields: { outcome: 'lost' } }];
  assert.strictEqual(fn(day), '10 calls · 3 closed · 5 open · 2 lost', 'Justin\'s line');
  assert.strictEqual(fn([]), null);
});

test('⚠⚠ THE TYPE IS A TAG: a select styled as the outcome tag with the map\'s words; not-a-sales-call is a static badge; no button', () => {
  const src = fnBody(LIVE, 'callTypeTagHtml');
  const pg = pageFns();
  const fn = new Function('CALL_TYPE_LABELS', 'escapeHtml', src + '\n return callTypeTagHtml;')(pg.CALL_TYPE_LABELS, (s) => String(s));
  const booked = fn('c1', 'booked', false), follow = fn('c1', 'follow_up', false), ns = fn('c1', 'follow_up', true);
  assert.ok(/<select class="outcome-tag-select call-type-select"/.test(booked) && /<option value="booked" selected>Booked<\/option>/.test(booked) && /<option value="follow_up">Follow-up<\/option>/.test(booked), booked);
  assert.ok(/<option value="follow_up" selected>Follow-up<\/option>/.test(follow));
  assert.ok(/outcome-tag-badge call-type-badge">Not a sales call</.test(ns) && !/<select/.test(ns), 'a static badge when not a sales call');
  assert.ok(!/<button/.test(booked + follow + ns), 'a tag, not a button');
  assert.ok(!/function callKindBtnHtml|Mark as Follow-up|Booked Call'/.test(LIVE), 'the button and its action labels are gone');
  assert.ok(/callTypeTagHtml\(\(src\.id \|\| \(review && review\.id\) \|\| ''\), src\.call_kind, src\.not_a_sales_call === true\)/.test(LIVE), 'wired in the review header');
});

test('⚠ the prompts are handed the LABEL, never the machine word — digest v7, coaching through the map; the "follow up close" chip stays', () => {
  const dg = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-digest.js'), 'utf8'));
  assert.ok(/outcome: ' \+ \(a\.outcome \? outcomeLabel\(a\.outcome\) : 'unknown'\)/.test(dg), 'the digest call line carries the label');
  assert.ok(/"Open" is an OUTCOME meaning the call did not close/.test(dg), 'the digest rule names the new word');
  assert.ok(/DIGEST_PROMPT_VERSION = 'v[7-9]-|DIGEST_PROMPT_VERSION = 'v\d\d-/.test(dg), 'the lane version bumped with the prompt (v7 carried the label; v8 the knowledge base)');
  const co = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'coaching.js'), 'utf8'));
  assert.ok(/'Call outcome: ' \+ outcomeLabel\(outcome\) \+ '\.'/.test(co), 'the coaching prompt carries the label');
  assert.ok(/eod-chip-follow">follow up close</.test(LIVE), 'the follow-up close label (the call TYPE) stays exactly as ruled');
});
