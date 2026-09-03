// lib/outcome-labels.js — THE NAMING SPLIT (Justin's ruling 2026-09-03, H709).
//
// Two things had been sharing one word. The OUTCOME "follow_up" means "no decision yet,
// still alive" — as an outcome it was oddly named. The CALL TYPE "follow_up" means a
// call that follows a booked call. A closer saw "Follow-up" as the outcome beside a
// "Mark as follow-up" control for the type, and the word was taken by the outcome.
//
// SO: the outcome reads  Closed · Open · Lost · No-show · DQ   (follow_up → Open)
//     the call type reads Booked · Follow-up · Not a sales call
// THE STORED VALUES DO NOT CHANGE — `follow_up` stays `follow_up` in both columns.
// Only the word a customer reads changes. ONE map, every surface: dashboard.html
// mirrors this object verbatim (a browser cannot require) and
// test/outcome-labels-mirror.test.js executes the page's copy against this one —
// three string edits is how the old word would come back.
'use strict';
var OUTCOME_LABELS = { closed: 'Closed', follow_up: 'Open', lost: 'Lost', no_show: 'No-show', disqualified: 'DQ' };
var OUTCOME_ORDER = ['closed', 'follow_up', 'lost', 'no_show', 'disqualified'];
var CALL_TYPE_LABELS = { booked: 'Booked', follow_up: 'Follow-up', not_sales: 'Not a sales call' };
function outcomeLabel(outcome) {
  var k = (typeof outcome === 'string') ? outcome.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(OUTCOME_LABELS, k) ? OUTCOME_LABELS[k] : (k ? outcome : 'Unknown');
}
function callTypeLabel(kind, notSales) {
  if (notSales === true) return CALL_TYPE_LABELS.not_sales;
  var k = (typeof kind === 'string') ? kind.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(CALL_TYPE_LABELS, k) ? CALL_TYPE_LABELS[k] : CALL_TYPE_LABELS.booked;
}
module.exports = { OUTCOME_LABELS: OUTCOME_LABELS, OUTCOME_ORDER: OUTCOME_ORDER, CALL_TYPE_LABELS: CALL_TYPE_LABELS, outcomeLabel: outcomeLabel, callTypeLabel: callTypeLabel };
