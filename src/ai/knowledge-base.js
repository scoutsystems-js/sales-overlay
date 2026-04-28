// KnowledgeBase: client for the shared Supabase knowledge_base table.
//
// v1.1.x architecture change: the search path now routes through the Railway
// backend's /kb/search route (which generates Voyage embeddings server-side
// and applies user/team scope). The legacy direct Voyage call was broken
// (no API key in the desktop env post-v1.0.4) and the legacy direct Supabase
// search had no scoping — both replaced by `search()`.
//
// `searchByText()` is kept as a local fallback for when the proxy isn't
// available (e.g. before a session has built one, or if Railway is down).
// `getFrameworkPhases()`, `getByCategory()`, `addEntry()`, `addEntries()`,
// and `buildContext()` are unchanged — they query Supabase directly by
// category/label, which doesn't need scoping.

var { createClient } = require('@supabase/supabase-js');

class KnowledgeBase {
  constructor(supabaseUrl, supabaseKey, proxyClient) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.proxy = proxyClient || null;
    this.activeClient = 'generic'; // Set by main process on session start
  }

  // Primary search method (v1.1.x). Calls /kb/search on the Railway backend,
  // which handles Voyage embeddings + user/team/global scoping. Falls back
  // to local text search if no proxy is available or the proxy errors.
  async search(queryText, matchCount) {
    matchCount = matchCount || 5;
    if (this.proxy && typeof this.proxy.kbSearch === 'function') {
      try {
        var res = await this.proxy.kbSearch(queryText, matchCount);
        if (res && Array.isArray(res.results)) {
          return res.results;
        }
      } catch (err) {
        console.error('[kb] Proxy search failed, falling back to local text search:', err.message);
      }
    }
    return this.searchByText(queryText, matchCount);
  }

  // Local text-search fallback. Direct Supabase fetch + JS scoring. Kept
  // for offline/proxy-unavailable scenarios. Preserves the activeClient
  // scoring for backwards compatibility with any pre-v1.1.x entries that
  // used metadata.client for tagging — new uploads (v1.1.x+) use the
  // uploaded_by/scope columns instead and don't need this filter.
  async searchByText(queryText, matchCount) {
    matchCount = matchCount || 5;
    var lower = queryText.toLowerCase();

    var result = await this.supabase
      .from('knowledge_base')
      .select('*')
      .limit(200);

    if (!result.data) return [];

    var self = this;
    var scored = result.data.map(function(row) {
      var score = 0;

      // Boost client-specific results (strong preference for active client) —
      // legacy metadata.client tag, NOT the new scope column.
      var rowClient = (row.metadata && row.metadata.client) ? row.metadata.client : null;
      if (rowClient && rowClient === self.activeClient) {
        score += 20;
      } else if (rowClient && rowClient !== self.activeClient && self.activeClient !== 'generic') {
        score -= 5;
      }

      // Check triggers
      if (row.triggers) {
        for (var i = 0; i < row.triggers.length; i++) {
          if (lower.indexOf(row.triggers[i].toLowerCase()) !== -1) {
            score += 10;
          }
        }
      }

      // Check label
      if (lower.indexOf(row.label.toLowerCase()) !== -1) {
        score += 5;
      }

      // Check content word overlap
      var words = lower.split(/\s+/);
      var contentLower = row.content.toLowerCase();
      for (var j = 0; j < words.length; j++) {
        if (words[j].length > 3 && contentLower.indexOf(words[j]) !== -1) {
          score += 1;
        }
      }

      row._score = score;
      return row;
    });

    scored.sort(function(a, b) { return b._score - a._score; });
    return scored.slice(0, matchCount).filter(function(r) { return r._score > 0; });
  }

  // Search for all phases of a specific framework — direct Supabase query,
  // unchanged from pre-v1.1.x. Used by the live suggestion engine for
  // exact-match objection framework lookups (not text search).
  async getFrameworkPhases(frameworkId) {
    var result = await this.supabase
      .from('knowledge_base')
      .select('*')
      .eq('category', 'objection_framework')
      .filter('metadata->>framework', 'eq', frameworkId)
      .order('metadata->>phase', { ascending: true });

    return result.data || [];
  }

  // Search by category — direct Supabase query, unchanged.
  async getByCategory(category, limit) {
    limit = limit || 10;
    var result = await this.supabase
      .from('knowledge_base')
      .select('*')
      .eq('category', category)
      .limit(limit);

    return result.data || [];
  }

  // Legacy single-entry insert. Pre-v1.1.x used by the original script
  // upload flow in src/ai/script-parser.js. New user uploads (v1.1.x+) go
  // through /kb/upload on the backend, which handles chunking + embeddings
  // + scope tagging. This path stays for backwards compat with the old
  // upload-script IPC handler.
  async addEntry(category, label, content, triggers, metadata) {
    triggers = triggers || [];
    metadata = metadata || {};

    var entry = {
      category: category,
      label: label,
      content: content,
      triggers: triggers,
      metadata: metadata,
    };

    var result = await this.supabase
      .from('knowledge_base')
      .insert(entry)
      .select();

    return result.data ? result.data[0] : null;
  }

  // Bulk add entries
  async addEntries(entries) {
    var results = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var result = await this.addEntry(e.category, e.label, e.content, e.triggers, e.metadata);
      if (result) results.push(result);
    }
    return results;
  }

  // Build context string for Claude from search results
  buildContext(results) {
    if (!results || results.length === 0) return '';

    var lines = ['KNOWLEDGE BASE MATCHES:'];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      lines.push('');
      if (r.metadata && r.metadata.framework && r.metadata.phase) {
        lines.push('[FRAMEWORK: ' + r.metadata.framework.toUpperCase() + ' - PHASE ' + r.metadata.phase + ': ' + r.metadata.phaseLabel + ']');
      } else {
        lines.push('[' + r.category.toUpperCase() + '] ' + r.label);
      }
      lines.push(r.content);
      if (r.metadata && r.metadata.followUp) {
        lines.push('Coaching note: ' + r.metadata.followUp);
      }
      if (r.metadata && r.metadata.nextPhase) {
        lines.push('Next phase: ' + r.metadata.nextPhase);
      }
    }
    return lines.join('\n');
  }
}

module.exports = KnowledgeBase;
