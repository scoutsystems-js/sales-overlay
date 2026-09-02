'use strict';
/* ⚠⚠ THE TRADING-CARD REP CARD — TREATMENT C, JUSTIN'S PICK (2026-09-02).
   The five section grades are the picture: a name band with the movement
   chip, headline (closing rate, at the DISPLAY step — "go big") and two stats
   on the left, the five section bars on the right with the weakest one lit,
   the weakest objection in the foot. ONE renderer, TWO placements: the
   Performance page grid and the catalog widget. These drive the real
   `repCardHtml` with the live payload shape (Josh's board, 2026-09-02) and
   assert the paid-for constraints on the OUTPUT, not the source. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./helpers/strip-comments');
const { BANDS } = require('../lib/metric-band');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

const JOSH = { user_id: '40616e16-aaaa', display_name: 'Josh P', active: true, calls_analyzed: 140, avg_score: 60, prior_avg_score: 63, trend: -1,
  avg_call_time: 47.3, time_to_price: 34.1, prospect_close_rate: 24, prospect_close_wins: 29, prospect_close_total: 121,
  obj_handled: 15, obj_total: 112, obj_handle_rate: 13, sections: { intro: 61, discovery: 55, pitch: 64, objection: 64, close: 62 },
  weakest_section: { section: 'discovery', score: 55 },
  weakest_objection: { category: 'timing', rate: 0, handled: 0, total: 25, comparable: true, team_rate: 9, is_lowest: true } };
const DRE = Object.assign({}, JOSH, { user_id: 'dre', display_name: 'Dre Wisam', calls_analyzed: 52, avg_score: 50, prior_avg_score: null, trend: 0,
  avg_call_time: 44.1, time_to_price: null, prospect_close_rate: 10, prospect_close_wins: 4, prospect_close_total: 40, obj_handled: 5, obj_total: 37, obj_handle_rate: 14,
  sections: { intro: 54, discovery: 57, pitch: 57, objection: 57, close: 50 }, weakest_section: { section: 'close', score: 48 }, weakest_objection: null });
const DANIEL = { user_id: 'dan', display_name: 'Daniel Lizarazo', active: true, calls_analyzed: 0, avg_score: null, prior_avg_score: null, trend: 0,
  avg_call_time: null, time_to_price: null, prospect_close_rate: null, prospect_close_wins: 0, prospect_close_total: 0, obj_handled: 0, obj_total: 0, obj_handle_rate: null,
  sections: { intro: null, discovery: null, pitch: null, objection: null, close: null }, weakest_section: null, weakest_objection: null };

function liveCard() {
  const parts = ['repCardHtml', 'repMovementHtml', 'repBandStatHtml', 'repSectionBarsHtml', 'repWeakestObjectionHtml', 'repMonogram', 'bandSideOf', 'closeRateDisplay', 'repName']
    .map((n) => fnBody(LIVE, n)).join('\n');
  const src = "var SECTION_LABEL = { intro: 'Intro', discovery: 'Discovery', pitch: 'Pitch', objection: 'Objection', close: 'Close' };\n"
    + "var OBJECTION_LABEL = { timing: 'Timing', partner: 'Partner', fear: 'Fear', logistical: 'Logistical', uncategorized: 'Other' };\n"
    + "function objectionLabel(k) { return OBJECTION_LABEL[k] || k; }\n"
    + "function personName(r, e, id) { return e || id; }\n"
    + "function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\"/g,'&quot;'); }\n"
    + parts + '\nreturn repCardHtml;';
  return new Function('state', src);
}
const STATE = { teamOverview: { bands: BANDS } };

test('⚠⚠ the card leads with the closing rate AND its counts; movement sits by the GRADE, never by the closes', () => {
  const html = liveCard()(STATE)(JOSH);
  assert.ok(/rep-card-lead-val[^>]*>24%</.test(html), 'headline is the closing rate');
  assert.ok(html.indexOf('29 of 121 prospects') !== -1, 'the counts ride with the rate');
  const band = html.slice(html.indexOf('rep-card-band'), html.indexOf('rep-card-body'));
  const lead = html.slice(html.indexOf('rep-card-lead'), html.indexOf('rep-card-bars'));
  assert.ok(/rep-move[^>]*>[^<]*▼ 3 vs prior period/.test(band), 'the movement chip is in the name band: ' + band.slice(0, 300));
  assert.ok(!/rep-move/.test(lead), 'no movement clause anywhere near the closes');
  assert.ok(!/\b(but|however)\b/i.test(html.replace(/<[^>]+>/g, ' ')), 'never diminish: no subtracting clause');
});

test('⚠⚠ the five section bars are the picture; exactly ONE is lit and it is the weakest', () => {
  const html = liveCard()(STATE)(JOSH);
  const bars = html.match(/class="rep-bar(?: weak)?"/g) || [];
  assert.strictEqual(bars.length, 5, 'five section bars');
  assert.strictEqual(bars.filter((b) => / weak/.test(b)).length, 1, 'exactly one lit');
  const weakAt = html.indexOf('class="rep-bar weak"');
  assert.ok(/Discovery/.test(html.slice(weakAt, weakAt + 200)), 'the lit bar is Discovery (55)');
  assert.ok(!/scoreColor|var\(--good\)|var\(--mid\)|var\(--bad\)/.test(html), 'grades are uncoloured — every grade on this team is one band');
  assert.ok(html.indexOf('Avg grade 60') !== -1, 'the average grade is in the foot');
});

test('⚠ banded metrics state their side; unmeasured is named, never drawn as zero', () => {
  const josh = liveCard()(STATE)(JOSH);
  assert.ok(/47\.3[\s\S]{0,140}rep-side">over</.test(josh), '47.3 min OVER: ' + josh.slice(josh.indexOf('47.3') - 40, josh.indexOf('47.3') + 160));
  const dre = liveCard()(STATE)(DRE);
  assert.ok(/44\.1[\s\S]{0,120}in the band/i.test(dre), '44.1 min · in the band');
  assert.ok(!/rep-move/.test(dre), 'no prior period → no movement chip');
  assert.ok(/not enough objections yet/i.test(dre), 'weakest objection unmeasured is said, not zeroed');
  const dan = liveCard()(STATE)(DANIEL);
  assert.ok(/No graded calls in this range/.test(dan) && /not a zero/.test(dan), 'the unmeasured card says so');
  assert.ok(!/0%/.test(dan) && !/rep-bar/.test(dan), 'no zeros, no empty bars for an unmeasured rep');
  assert.ok(/rep-mono[^>]*>DL</.test(dan) && /rep-mono[^>]*>JP</.test(josh), 'monogram from the initials');
});

test('⚠⚠ THE HEADLINE IS THE GAUGES\' STEP (24px) — Justin reversed "go big"; --fs-display keeps its one meaning', () => {
  assert.ok(/\.rep-card-lead-val \{[^}]*var\(--fs-gauge-value\)/.test(LIVE), 'the card headline uses --fs-gauge-value');
  assert.ok(!/\.rep-card-lead-val \{[^}]*var\(--fs-display\)/.test(LIVE), 'never --fs-display: eight cards at 48 is eight loud numbers');
  const tok = HTML.slice(HTML.indexOf('--fs-display:'), HTML.indexOf('--fs-display:') + 80);
  assert.ok(/the ONE loud number on a page/.test(tok), 'the standing rule at the token is untouched: ' + tok);
});

test('⚠ bandSideOf mirrors lib/metric-band sideOf on every edge — the edges come from the payload, only the comparison is repeated', () => {
  const { sideOf } = require('../lib/metric-band');
  const src = fnBody(LIVE, 'bandSideOf') + '\nreturn bandSideOf;';
  const client = new Function(src)();
  [null, 0, 19.9, 20, 34.9, 35, 40, 45, 45.1, 60, 61, 99].forEach((v) => {
    ['avg_call_time', 'time_to_price'].forEach((k) => {
      assert.strictEqual(client(v, BANDS[k]), sideOf(v, BANDS[k]), k + ' at ' + v);
    });
  });
  assert.strictEqual(client(40, null), null, 'no band, no side');
});

test('⚠⚠ PLACEMENT: gauges → cards → graphs, and the three score lists are gone', () => {
  const fn = fnBody(LIVE, 'renderTeamPerformance');
  const body = fn.slice(fn.indexOf('content.innerHTML =\n      teamHeaderHtml()'));   // the main body, not the drill branch
  const g = body.indexOf('avgPanelHtml()'), c = body.indexOf('teamControlsHtml()'), r = body.indexOf('repCardsHtml()'), s = body.indexOf('repSeriesSectionHtml()');
  assert.ok(g > 0 && c > g && r > c && s > r, 'order gauges < controls < cards < graphs: ' + [g, c, r, s]);
  assert.strictEqual((LIVE.match(/teamScoreListHtml\(/g) || []).length, 0, 'the three score lists are retired');
  assert.strictEqual(LIVE.indexOf('<h2>Closing Score</h2>'), -1);
  assert.strictEqual(LIVE.indexOf('<h2>Objection Handling Score</h2>'), -1);
  const panels = LIVE.slice(LIVE.indexOf('var TEAM_PANELS = ['), LIVE.indexOf('var TEAM_PANELS_KEY'));
  ['overview', 'closing', 'objection'].forEach((k) => assert.strictEqual(panels.indexOf("key: '" + k + "'"), -1, 'panel key ' + k + ' retired'));
});

test('⚠⚠ ONE RENDERER, TWO PLACEMENTS — the widget calls the same repCardHtml', () => {
  assert.ok(/card\.view === 'rep_card'\s*\?\s*dashRepCardHtml\(card\)/.test(fnBody(LIVE, 'dashCardHtml')), 'dashCardHtml dispatches rep_card');
  const w = fnBody(LIVE, 'dashRepCardHtml');
  assert.ok(w.indexOf('repCardHtml(') !== -1, 'the widget renders through repCardHtml');
  assert.ok(w.indexOf("card.metric === 'rep_card'") !== -1, 'the widget refuses any other metric');
  assert.ok(/rep: c\.rep/.test(fnBody(LIVE, 'dashSaveEdit')), 'the chosen closer is saved with the card');
  assert.ok(fnBody(LIVE, 'dashPickRep').length > 100, 'the picker has a rep step');
  assert.ok(fnBody(LIVE, 'dashRenderPicker').indexOf('m.person') !== -1, 'the picker branches on a person entry');
});
