// Pure metrics for the coaching glance tiles (A-1 boot-fetch-safe — no I/O, no LLM).

// Objection HANDLE RATE over TRUE objections only. Input is the needs-work result
// (state.needsWork); its detail.buckets already EXCLUDE logistical barriers +
// disqualifications — that split is the "What needs work" card's LLM bucket
// classification, cached and already loaded on the overview. The tile REUSES it so
// the handle % and the card below it agree, and the tile never triggers its own
// LLM. Returns { rate, handled, total } or null when the classification isn't
// available (still loading / error) or there are no true objections → tile renders "—".
function objectionHandleRate(needsWork) {
  var d = needsWork && needsWork.detail;
  if (!d || !Array.isArray(d.buckets)) return null;
  var handled = 0, total = 0;
  for (var i = 0; i < d.buckets.length; i++) {
    var b = d.buckets[i] || {};
    handled += (typeof b.handled === 'number') ? b.handled : 0;
    total += (typeof b.total === 'number') ? b.total : 0;
  }
  if (total <= 0) return null;
  if (handled > total) handled = total; // defensive — never report >100%
  return { rate: Math.round((handled / total) * 100), handled: handled, total: total };
}

// Period-over-period AVG SCORE trend. cur = this window's mean; prior = the prior
// equal-length window's mean (computed via the REUSED team-analytics machinery).
// Returns { dir, delta_pct }: dir ∈ 'up'|'down'|'flat' with a delta %, OR dir=null
// when there is NO prior baseline (new user / window predates the first call) or
// prior <= 0 (division guard) → the tile renders with no arrow, not a misleading 0%.
function scoreTrend(cur, prior) {
  if (typeof cur !== 'number' || typeof prior !== 'number') return { dir: null, delta_pct: null };
  if (prior <= 0) return { dir: null, delta_pct: null };
  var pct = Math.round(((cur - prior) / prior) * 100);
  var dir = pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat');
  return { dir: dir, delta_pct: pct };
}

module.exports = { objectionHandleRate: objectionHandleRate, scoreTrend: scoreTrend };
