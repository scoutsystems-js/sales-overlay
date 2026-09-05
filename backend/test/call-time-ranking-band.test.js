'use strict';
/* ⚠⚠ FIX #4 — AVERAGE CALL TIME IS RANKED BY THE RULED BAND, NOT BY "LOWER IS
   BETTER". Two rulings share this metric on purpose: the NUMBER CARD's caption
   is a ceiling ("at or below 60 min", H125), so the catalog entry carries
   `target: 60, targetDirection: 'lower_is_better'`; the RANKED view lists reps
   by distance from the 35–45 sweet spot and ties everyone inside it (H518), so
   the wire attaches `band` from lib/metric-band.js in publicMetric (widget-catalog
   :364) and the dashboard's dashRepRanking prefers a band whenever the card has
   one. Sweep block 6 read the entry, saw the direction and no band, and filed
   "the shortest call ranks first, one click from live" — this test EXECUTES the
   path the click takes and shows it is banded. Both plants fail it (H678): the
   band not attached on the wire; the band attached but the ranking ignoring it. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const C = require('../lib/widget-catalog');
const BAND = require('../lib/metric-band.js');

const HTML = stripComments(fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8'));
function grab(start, end) { const a = HTML.indexOf(start); assert.ok(a > -1, 'stale anchor: ' + start); const b = HTML.indexOf(end, a); assert.ok(b > a, 'stale end: ' + end); return HTML.slice(a, b + end.length); }
function pageFn(src, scope) {
  const proxy = new Proxy(scope, { has: (t, k) => (k in t) || !(k in globalThis), get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : function () {})) });
  return new Function('__s', 'with (__s) { ' + src + '\n return { run: __run }; }')(proxy);
}
/* the card exactly as a click on the picker builds it: from the SERVED entry (publicMetric), not the raw catalog row */
function servedCard() {
  const m = C._publicMetric(C.byKey('avg_call_time'));
  return { metric: m.key, view: 'by_rep', target: (typeof m.target === 'number') ? m.target : null, targetDirection: m.targetDirection || 'higher_is_better', band: m.band || null, categories: m.categories || null };
}
function rank(card, perRep) {
  const src = grab('function dashRepRanking(card) {', '\n  }') + '\n var __run = dashRepRanking;';
  return pageFn(src, { state: { teamOverview: { per_rep: perRep } }, console }).run(card);
}
/* the ranking keys rows by display_name (dashRepRanking builds { name, v }) */
const REPS = [
  { user_id: 'u1', display_name: 'short', avg_call_time: 12 },   // 13 of Nathan's 27 were under 20 — the case Justin ruled against
  { user_id: 'u2', display_name: 'in1',   avg_call_time: 40 },
  { user_id: 'u3', display_name: 'in2',   avg_call_time: 38 },
  { user_id: 'u4', display_name: 'long',  avg_call_time: 70 },
  { user_id: 'u5', display_name: 'none',  avg_call_time: null },
];

test('⚠⚠ the served card carries the RULED band (35–45 / 20–60) — attached on the wire, not typed on the entry', () => {
  const card = servedCard();
  assert.deepStrictEqual(card.band, BAND.bandFor('avg_call_time'), 'the band on the wire must be the one metric-band.js rules');
  assert.deepStrictEqual(card.band.good, [35, 45]);
  assert.deepStrictEqual(card.band.ok, [20, 60]);
  assert.strictEqual(card.targetDirection, 'lower_is_better', 'the caption direction stays: 60 is the number card\'s ceiling (H125)');
});
/* ⚠⚠ CONVERTED 2026-09-05 (H736, Justin's ruling): AVERAGE CALL TIME IS NEVER A RANK. The two tests below asserted
   that the ranked view ranks by the band; the ranked view for call time no longer exists — the click path now REFUSES
   the card. THE SUBJECT SURVIVES on time_to_price: a card with a band ranks by the band, never by a direction, and
   without its band the same rows rank shortest-first (the non-vacuity). */
test('⚠⚠ H736: the ranked view for call time is REFUSED on the click path — no ranking, no measured rows, the honest sentence', () => {
  const r = rank(servedCard(), REPS);
  assert.ok(r && r.error && /no per-rep card can show this metric/.test(r.error), 'refused: ' + JSON.stringify(r));
  assert.ok(!r.measured && !r.banded && !r.lowerIsBetter, 'nothing ranked');
});
const TTP = [
  { user_id: 'u1', display_name: 'early', time_to_price: 8 },
  { user_id: 'u2', display_name: 'in1',   time_to_price: 30 },
  { user_id: 'u3', display_name: 'late',  time_to_price: 70 },
  { user_id: 'u5', display_name: 'none',  time_to_price: null },
];
function ttpCard() { const m = C._publicMetric(C.byKey('time_to_price')); return { metric: m.key, view: 'by_rep', target: null, targetDirection: m.targetDirection || 'higher_is_better', band: m.band || null, categories: null }; }
test('⚠⚠ the subject survives on time to price: a card with a band ranks BY THE BAND, ties the in-band rep last, states every side', () => {
  const r = rank(ttpCard(), TTP);
  assert.strictEqual(r.banded, true, 'a card with a band must rank by the band, never by a direction');
  const by = {}; r.measured.forEach((x) => { by[x.name] = x; });
  assert.strictEqual(by.in1.dist, 0); assert.strictEqual(by.in1.side, 'in'); assert.strictEqual(by.early.side, 'under'); assert.strictEqual(by.late.side, 'over');
  assert.strictEqual(r.unmeasured, 1);
  assert.ok(r.measured.map((x) => x.name).indexOf('in1') === r.measured.length - 1, 'furthest from the band first — the in-band rep last');
});
test('⚠ NON-VACUITY: strip the band and the SAME rows rank by the direction — which is why the band must travel on the wire', () => {
  const card = ttpCard(); card.band = null;
  const r = rank(card, TTP);
  assert.ok(!r.banded); assert.ok(r.measured && r.measured.length === 3);
});
