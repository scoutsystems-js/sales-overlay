'use strict';
async function promptBranch(admin, id) {
  var q = await admin.from('call_analyses').select('fathom_call_id, outcome').eq('id', id);
  var a = q.data[0];
  if (a.why_outcome === null) return 'no reason recorded';              // P1 why_outcome was never selected: undefined, not null
  if (a.outcome === null) return 'no outcome';                          // N1 selected: null is reachable
  if (a.cash_collected == null) return 'no cash';                       // N2 loose: catches undefined too
  return a.outcome;
}
function literalCheck() {
  var o = { a: 1, b: null };
  if (o.c === null) return 'c unset';                                   // P4 c was never put on the literal
  if (o.b === null) return 'b unset';                                   // N5 b is null on the literal
  return 'ok';
}
function evidenceLine(m) {
  var said = m.closer_response || m.quote;                              // P2 a sentinel is non-empty and wins
  return said;
}
function evidenceLineGuarded(m) {
  var said = displayCloserResponse(m.closer_response) || m.quote;       // N3 through the guard
  return said;
}
function listHtml(d) {
  if (!d) return 'loading';
  return '<ul>' + d.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';   // P3 no laneProblem: { _error } draws an empty list
}
function listHtmlGuarded(d) {
  if (!d) return 'loading';
  if (laneProblem(d)) return 'failed';                                  // N4 the one predicate first
  return '<ul>' + d.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
}
async function settled(q) {
  var r = await q.catch(function () { return undefined; });
  if (r.error) return 'failed';                                         // P5 r can be undefined: TypeError, not a branch
  return r.data;
}
module.exports = { promptBranch, literalCheck, evidenceLine, evidenceLineGuarded, listHtml, listHtmlGuarded, settled };
