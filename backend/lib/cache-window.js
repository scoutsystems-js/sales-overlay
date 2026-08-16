/**
 * Cache-key window snapping (sub-stage 0 of the calendar date picker).
 *
 * ⚠ WHAT THIS FIXES, MEASURED. `setDateRange`/`setTeamRange` build `to = new
 * Date()` at click time, so every range carried millisecond precision into
 * `objection_synthesis_cache`'s (user_id, synthesis_type, from_ts, to_ts,
 * analysis_set_hash) key. On the live cache that meant distinct windows ≈ row
 * count in every LLM lane — `performance` 60 rows / 60 distinct windows across 4
 * users, `team` 39 / 39 across ONE manager, 60 of 60 `performance` rows with a
 * non-midnight `to`. The cache was written and almost never read: ~8 Claude
 * generations a day that should have been hits.
 *
 * ⚠ WHY COLLAPSING THE KEY IS SAFE. `analysis_set_hash` already does freshness,
 * and does it correctly: every lane folds `fathom_call_id + ':' + analyzed_at`
 * for each done analysis into it (verified across objections, performance, team,
 * highlights, team_needs_work, needs_work and digest). Those analyses are loaded
 * with the EXACT from/to, so two windows that snap to the same key but cover
 * different data produce different hashes and cannot collide. The timestamps
 * were duplicating the hash's job at a precision that guaranteed a miss.
 *
 * ⚠ THIS IS FOR CACHE KEYS ONLY — never for the data query. Snapping the query
 * window would change which calls get aggregated, which is a behaviour change
 * and not what this is. Callers pass exact values to their loaders and snapped
 * values to the cache.
 *
 * NO-OPS BY DESIGN: `team-digest` already keys on date@00:00Z (the one lane with
 * real reuse today), and `page_summary`/`coaching_areas` key on epoch sentinels
 * with the real key in the hash. All three are unchanged by snapping, which is
 * how it should be — this only removes precision that was never meaningful.
 */

// One instant → midnight UTC of its own day, as an ISO string.
// Unparseable input is returned UNCHANGED: a cache key is not worth failing a
// request over, and passing it through simply forgoes the benefit.
function snapCacheTs(ts) {
  if (typeof ts !== 'string' || ts === '') return ts;
  var ms = Date.parse(ts);
  if (isNaN(ms)) return ts;
  var d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function snapCacheWindow(from, to) {
  return { from: snapCacheTs(from), to: snapCacheTs(to) };
}

module.exports = { snapCacheTs: snapCacheTs, snapCacheWindow: snapCacheWindow };
