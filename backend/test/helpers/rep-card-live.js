'use strict';
/* ⚠ THE LIVE REP CARD, EXECUTED — shared by test/rep-card.test.js (the markup's
   constraints) and test/rep-card-border-rendered.test.js (the RENDERED edge).
   One harness: the real `repCardHtml` and its helpers lifted from the page and
   driven with the live payload shape (Josh's board, 2026-09-02). */
const fs = require('fs');
const path = require('path');
const { stripComments, fnBody } = require('./strip-comments');
const { BANDS } = require('../../lib/metric-band');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = stripComments(HTML);

const JOSH = { user_id: '40616e16-aaaa', display_name: 'Josh P', active: true, calls_analyzed: 140, avg_score: 60, prior_avg_score: 63, trend: -1,
  avg_call_time: 47.3, time_to_price: 34.1, prospect_close_rate: 24, prospect_close_wins: 29, prospect_close_total: 121, close_delta: -3, obj_delta: 2, time_delta: 1.4,
  obj_handled: 15, obj_total: 112, obj_handle_rate: 13, sections: { intro: 61, discovery: 55, pitch: 64, objection: 64, close: 62 },
  weakest_section: { section: 'discovery', score: 55 },
  weakest_objection: { category: 'timing', rate: 0, handled: 0, total: 25, comparable: true, team_rate: 9, is_lowest: true } };
const DRE = Object.assign({}, JOSH, { user_id: 'dre', display_name: 'Dre Wisam', calls_analyzed: 52, avg_score: 50, prior_avg_score: null, trend: 0,
  close_delta: null, obj_delta: null, time_delta: null,   /* no prior period → no arrows (H704) */
  avg_call_time: 44.1, time_to_price: null, prospect_close_rate: 10, prospect_close_wins: 4, prospect_close_total: 40, obj_handled: 5, obj_total: 37, obj_handle_rate: 14,
  sections: { intro: 54, discovery: 57, pitch: 57, objection: 57, close: 50 }, weakest_section: { section: 'close', score: 48 }, weakest_objection: null });
const DANIEL = { user_id: 'dan', display_name: 'Daniel Lizarazo', active: true, calls_analyzed: 0, avg_score: null, prior_avg_score: null, trend: 0,
  avg_call_time: null, time_to_price: null, prospect_close_rate: null, prospect_close_wins: 0, prospect_close_total: 0, obj_handled: 0, obj_total: 0, obj_handle_rate: null,
  sections: { intro: null, discovery: null, pitch: null, objection: null, close: null }, weakest_section: null, weakest_objection: null };

function liveCard() {
  const parts = ['repCardHtml', 'repDeltaHtml', 'repBandStatHtml', 'repSectionBarsHtml', 'repWeakestObjectionHtml', 'repMonogram', 'bandSideOf', 'closeRateDisplay', 'repName']
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

module.exports = { liveCard, JOSH, DRE, DANIEL, STATE, HTML, LIVE };
