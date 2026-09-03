// lib/classifier-harness.js — THE BLIND HARNESS (Justin's ruling 2026-09-03, H708:
// "build the harness before the classifier"). Pure: draws sets and scores rows.
//
// THE RULES IT ENCODES:
//   • two sets, SHUFFLED, LABELS HELD ASIDE — drawSets returns ids only; the labels go
//     in a separate map the runner never receives;
//   • tune on the first, score on the second — the held-out number is the only one
//     Justin is told;
//   • the base rate beside every score — "always say sales" scores the base rate;
//   • the TWO ERRORS reported separately, never as one accuracy figure: a wrong
//     "not_sales" deletes a real call from every rate silently (the expensive one);
//     a wrong "sales" leaves a training in a rep's numbers;
//   • UNSURE is an outcome, not an error — its rate is reported on its own;
//   • mistakes grouped by REASON CLASS, not by count; and the rows it got RIGHT FOR
//     THE WRONG REASON (verdict right, reason class from the other side) listed —
//     the most dangerous row, because it scores as a success.
'use strict';

/* mulberry32 — a seeded shuffle so a draw is reproducible and the seed is on record */
function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, r) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

/* items: [{ id, label: 'sales'|'not_sales', stratum, hard: bool }]
   → { tuning: [ids], held_out: [ids], labels: {id: label}, manifest } — every stratum is
   split by tuningShare; hard cases are split too (never all on one side); order shuffled. */
function drawSets(items, opts) {
  var o = opts || {}; var share = (typeof o.tuningShare === 'number') ? o.tuningShare : (1 / 3);
  var r = rng(typeof o.seed === 'number' ? o.seed : 20260903);
  var byStratum = {};
  (items || []).forEach(function (it) { if (!it || !it.id || !it.label) return; var k = (it.hard ? 'hard:' : '') + it.label + ':' + (it.stratum || 'any'); (byStratum[k] = byStratum[k] || []).push(it); });
  var tuning = [], held = [], labels = {}, manifest = { seed: o.seed, tuningShare: share, strata: {} };
  Object.keys(byStratum).sort().forEach(function (k) {
    var list = shuffle(byStratum[k], r);
    var nT = Math.max(1, Math.round(list.length * share));
    if (list.length === 1) nT = (r() < share) ? 1 : 0;
    list.forEach(function (it, i) { labels[it.id] = it.label; (i < nT ? tuning : held).push(it.id); });
    manifest.strata[k] = { total: list.length, tuning: Math.min(nT, list.length), held_out: list.length - Math.min(nT, list.length) };
  });
  tuning = shuffle(tuning, r); held = shuffle(held, r);
  manifest.tuning = { n: tuning.length, base_rate_sales: rate(tuning, labels) };
  manifest.held_out = { n: held.length, base_rate_sales: rate(held, labels) };
  return { tuning: tuning, held_out: held, labels: labels, manifest: manifest };
}
function rate(ids, labels) { if (!ids.length) return null; var s = ids.filter(function (id) { return labels[id] === 'sales'; }).length; return Math.round((100 * s) / ids.length); }

var SALES_CLASSES = { prospect_logistics_only: 1, prospect_pitch_or_price: 1, prospect_discovery_only: 1 };
var NOT_SALES_CLASSES = { no_prospect_internal_staff: 1, training_or_roleplay: 1, reviewing_a_recorded_call: 1, recording_stub: 1 };
function sideOfClass(c) { if (SALES_CLASSES[c]) return 'sales'; if (NOT_SALES_CLASSES[c]) return 'not_sales'; return null; }

/* rows: [{ id, verdict, reason_class, reason }] ; labels: {id: 'sales'|'not_sales'} ; meta: {id: {title, ...}} optional
   → the report object. Rows without a label are ignored (and counted). */
function score(rows, labels, meta) {
  var m = meta || {};
  var out = { n: 0, unlabeled: 0, base_rate_sales: null, always_sales_would_score: null,
    wrong_not_sales: { count: 0, of: 0, rate: null, items: [] },   // label sales, verdict not_sales — the expensive error
    wrong_sales:     { count: 0, of: 0, rate: null, items: [] },   // label not_sales, verdict sales
    unsure:          { count: 0, rate: null, items: [] },
    right:           { count: 0 },
    right_for_wrong_reason: [],
    mistakes_by_reason: {}, no_verdict: 0 };
  var labeled = (rows || []).filter(function (r) { if (!r || !labels[r.id]) { out.unlabeled++; return false; } return true; });
  out.n = labeled.length;
  var nSales = labeled.filter(function (r) { return labels[r.id] === 'sales'; }).length;
  out.base_rate_sales = out.n ? Math.round((100 * nSales) / out.n) : null;
  out.always_sales_would_score = out.base_rate_sales;
  out.wrong_not_sales.of = nSales; out.wrong_sales.of = out.n - nSales;
  labeled.forEach(function (r) {
    var label = labels[r.id]; var item = { id: r.id, title: (m[r.id] || {}).title || null, label: label, verdict: r.verdict, reason_class: r.reason_class || null, reason: r.reason || null };
    if (!r.verdict) { out.no_verdict++; return; }
    if (r.verdict === 'unsure') { out.unsure.count++; out.unsure.items.push(item); return; }
    if (r.verdict === label) {
      out.right.count++;
      var side = sideOfClass(r.reason_class);
      if (side && side !== label) out.right_for_wrong_reason.push(item);
      return;
    }
    var bucket = (label === 'sales') ? out.wrong_not_sales : out.wrong_sales;
    bucket.count++; bucket.items.push(item);
    var k = r.reason_class || '(no class)';
    (out.mistakes_by_reason[k] = out.mistakes_by_reason[k] || []).push(item);
  });
  out.wrong_not_sales.rate = out.wrong_not_sales.of ? Math.round((1000 * out.wrong_not_sales.count) / out.wrong_not_sales.of) / 10 : null;
  out.wrong_sales.rate = out.wrong_sales.of ? Math.round((1000 * out.wrong_sales.count) / out.wrong_sales.of) / 10 : null;
  out.unsure.rate = out.n ? Math.round((1000 * out.unsure.count) / out.n) / 10 : null;
  return out;
}

/* Plain-language rendering for Justin: the two errors, the unsure rate, the base rate,
   the mistakes grouped by reason, the right-for-wrong-reason rows. */
function renderReport(rep, setName) {
  var L = [];
  L.push('BLIND SCORE — ' + setName + ' (n=' + rep.n + '; base rate: ' + rep.base_rate_sales + '% sales, so "always say sales" would score ' + rep.always_sales_would_score + '%)');
  L.push('  wrong "not a sales call" (a REAL call deleted from every rate — the expensive error): ' + rep.wrong_not_sales.count + ' of ' + rep.wrong_not_sales.of + ' real calls (' + rep.wrong_not_sales.rate + '%)');
  L.push('  wrong "sales" (a training left in a rep\'s numbers): ' + rep.wrong_sales.count + ' of ' + rep.wrong_sales.of + ' non-sales calls (' + rep.wrong_sales.rate + '%)');
  L.push('  unsure (stays with a human, counts as today): ' + rep.unsure.count + ' of ' + rep.n + ' (' + rep.unsure.rate + '%)' + (rep.no_verdict ? ' · no verdict returned: ' + rep.no_verdict : ''));
  L.push('  right: ' + rep.right.count + ' — of which RIGHT FOR THE WRONG REASON: ' + rep.right_for_wrong_reason.length);
  var ks = Object.keys(rep.mistakes_by_reason);
  L.push('  mistakes grouped by reason (' + ks.length + ' reason' + (ks.length === 1 ? '' : 's') + ' across ' + (rep.wrong_not_sales.count + rep.wrong_sales.count) + ' mistakes):');
  ks.forEach(function (k) { L.push('    ' + k + ': ' + rep.mistakes_by_reason[k].length); rep.mistakes_by_reason[k].forEach(function (it) { L.push('      - [' + it.label + ' → ' + it.verdict + '] "' + (it.title || it.id) + '": ' + (it.reason || '(no reason)')); }); });
  rep.right_for_wrong_reason.forEach(function (it) { L.push('    RIGHT-WRONG-REASON [' + it.label + ' via ' + it.reason_class + '] "' + (it.title || it.id) + '": ' + (it.reason || '')); });
  rep.unsure.items.forEach(function (it) { L.push('    UNSURE [' + it.label + '] "' + (it.title || it.id) + '": ' + (it.reason || '')); });
  return L.join('\n');
}

module.exports = { drawSets: drawSets, score: score, renderReport: renderReport, sideOfClass: sideOfClass, _rng: rng };
