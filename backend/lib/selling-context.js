// lib/selling-context.js — v1.4 KB-grounded coaching.
// Resolves a closer's SELLING CONTEXT (their offer docs / scripts) from the
// knowledge base for injection into the grader + synthesis prompts.
//
// NEVER throws: any failure (or missing content) returns { contextText: '',
// kbHash: 'none' } so a KB problem can never fail or stall an analysis.
//
// Include rule (matches the real upload shape — see routes/kb.js):
//   • The `category` COLUMN is always 'user_upload' for uploads; the real type
//     lives in metadata->>'category'. We include ONLY 'offer_document' (offer
//     docs AND scripts default to this) and hard-EXCLUDE winning_call +
//     learned_pattern + every seeded teleprompter framework entry (those are
//     never category='user_upload', so they can't leak in).
// Scope: personal (uploaded_by = user) → team (manager's team uploads) →
//   global (scope='global'). Dedup by chunk id.

const crypto = require('crypto');

var INCLUDE_META_CATEGORY = 'offer_document';
var DEFAULT_MAX_CHARS = 5000;

async function fetchSellingContext(admin, userId, maxChars) {
  var cap = maxChars || DEFAULT_MAX_CHARS;
  try {
    var prof = await admin.from('user_profiles').select('managed_by').eq('user_id', userId).maybeSingle();
    var managedBy = (prof.data && prof.data.managed_by) || null;

    var cols = 'id, label, scope, uploaded_by, content, metadata, created_at';
    function base() {
      return admin.from('knowledge_base').select(cols)
        .eq('category', 'user_upload').eq('metadata->>category', INCLUDE_META_CATEGORY);
    }
    // Precedence: personal uploads apply ONLY to UNMANAGED users. When the user
    // is managed, their coaching is governed by their manager's team KB, so
    // personal chunks are excluded (content is never deleted — unassigning the
    // user restores their personal context automatically). Because kbHash is
    // computed from the actually-included chunks below, a managed_by flip changes
    // the included set and naturally invalidates any cached synthesis.
    var personal = managedBy ? { data: [] } : await base().eq('uploaded_by', userId);
    var team = managedBy ? await base().eq('uploaded_by', managedBy).eq('scope', 'team') : { data: [] };
    var global = await base().eq('scope', 'global');
    if (personal.error) throw new Error('personal: ' + personal.error.message);
    if (team.error) throw new Error('team: ' + team.error.message);
    if (global.error) throw new Error('global: ' + global.error.message);

    // Group into sources (by label), grouped personal(0) → team(1) → global(2),
    // dedup chunk ids across scopes (a global doc uploaded by the user won't
    // double-count). Within a source, sort chunks by chunk_index asc.
    var seen = {}, sources = [], byKey = {};
    function addGroup(rows, groupPri) {
      (rows || []).forEach(function (r) {
        if (seen[r.id]) return; seen[r.id] = true;
        var key = groupPri + '::' + (r.label || r.id);
        var s = byKey[key];
        if (!s) { s = { label: r.label || '(untitled)', group: groupPri, order: sources.length, chunks: [] }; byKey[key] = s; sources.push(s); }
        var ci = (r.metadata && typeof r.metadata.chunk_index === 'number') ? r.metadata.chunk_index : 0;
        s.chunks.push({ id: r.id, content: r.content || '', chunk_index: ci, created_at: r.created_at });
      });
    }
    addGroup(personal.data, 0);
    addGroup(team.data, 1);
    addGroup(global.data, 2);
    if (sources.length === 0) return { contextText: '', kbHash: 'none', sources: [] };

    sources.sort(function (a, b) { return (a.group - b.group) || (a.order - b.order); });
    sources.forEach(function (s) { s.chunks.sort(function (a, b) { return a.chunk_index - b.chunk_index; }); });

    // Breadth-first selection under the char cap: round-robin over sources so
    // the first chunks of every source are preferred over deep chunks of one.
    // Chunk-boundary truncation — never include a partial chunk.
    var maxRounds = sources.reduce(function (m, s) { return Math.max(m, s.chunks.length); }, 0);
    var take = {}, total = 0;
    outer:
    for (var r = 0; r < maxRounds; r++) {
      for (var si = 0; si < sources.length; si++) {
        var c = sources[si].chunks[r];
        if (!c) continue;
        var cost = c.content.length + (total > 0 ? 2 : 0); // '\n\n' between chunks
        if (total + cost > cap) break outer;
        total += cost;
        take[si] = (take[si] || 0) + 1;
      }
    }
    // Emit grouped by source (personal→team→global), chunk_index asc — the taken
    // prefix. `sources` summary is for the dev harness only (grader/synthesis
    // read contextText + kbHash only).
    var groupName = ['personal', 'team', 'global'];
    var out = [], usedChunks = [], sourceSummary = [];
    for (var s2 = 0; s2 < sources.length; s2++) {
      var n = take[s2] || 0;
      if (n === 0) continue;
      var chars = 0;
      for (var k = 0; k < n; k++) { out.push(sources[s2].chunks[k].content); usedChunks.push(sources[s2].chunks[k]); chars += sources[s2].chunks[k].content.length; }
      sourceSummary.push({ label: sources[s2].label, group: groupName[sources[s2].group], chunks_total: sources[s2].chunks.length, chunks_used: n, chars: chars });
    }
    if (usedChunks.length === 0) return { contextText: '', kbHash: 'none', sources: [] };

    var contextText = out.join('\n\n');
    var kbHash = crypto.createHash('sha1')
      .update(usedChunks.map(function (c) { return c.id + ':' + (c.created_at || ''); }).sort().join('|'))
      .digest('hex');
    return { contextText: contextText, kbHash: kbHash, sources: sourceSummary };
  } catch (err) {
    console.error('[selling-context] fetch failed for user ' + userId + ' — returning empty: ' + (err && err.message));
    return { contextText: '', kbHash: 'none', sources: [] };
  }
}

module.exports = { fetchSellingContext: fetchSellingContext };
