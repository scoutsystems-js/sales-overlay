var { createClient } = require('@supabase/supabase-js');
var Anthropic = require('@anthropic-ai/sdk');

class KnowledgeBase {
  constructor(supabaseUrl, supabaseKey, anthropicKey) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
    this.embeddingCache = {};
    this.activeClient = 'generic'; // Set by main process on session start
  }

  // Generate embedding for a text string using Anthropic's Voyager model
  // Falls back to a simple keyword search if embedding fails
  async getEmbedding(text) {
    // Check cache first
    var cacheKey = text.substring(0, 100);
    if (this.embeddingCache[cacheKey]) {
      return this.embeddingCache[cacheKey];
    }

    try {
      // Use Supabase Edge Function or a direct fetch to an embedding API
      // For now, we'll use a simple approach with the Anthropic API
      // to generate a search-optimized query, then do text matching
      var response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (process.env.VOYAGE_API_KEY || ''),
        },
        body: JSON.stringify({
          input: [text],
          model: 'voyage-3-lite',
        }),
      });

      if (response.ok) {
        var data = await response.json();
        var embedding = data.data[0].embedding;
        this.embeddingCache[cacheKey] = embedding;
        return embedding;
      }
    } catch (err) {
      // Embedding API not available, fall back to text search
    }

    return null;
  }

  // Search knowledge base by vector similarity
  async searchByEmbedding(queryText, matchCount) {
    matchCount = matchCount || 5;
    var embedding = await this.getEmbedding(queryText);

    if (embedding) {
      var result = await this.supabase.rpc('match_knowledge', {
        query_embedding: embedding,
        match_threshold: 0.5,
        match_count: matchCount,
      });

      if (result.data && result.data.length > 0) {
        return result.data;
      }
    }

    // Fall back to text search
    return this.searchByText(queryText, matchCount);
  }

  // Search for all phases of a specific framework
  async getFrameworkPhases(frameworkId) {
    var result = await this.supabase
      .from('knowledge_base')
      .select('*')
      .eq('category', 'objection_framework')
      .filter('metadata->>framework', 'eq', frameworkId)
      .order('metadata->>phase', { ascending: true });

    return result.data || [];
  }

  // Fallback: search by text matching against triggers and content
  async searchByText(queryText, matchCount) {
    matchCount = matchCount || 5;
    var lower = queryText.toLowerCase();

    // Search by triggers array overlap — fetch more to score properly
    var result = await this.supabase
      .from('knowledge_base')
      .select('*')
      .limit(200);

    if (!result.data) return [];

    // Score each result by how well it matches the query
    var self = this;
    var scored = result.data.map(function(row) {
      var score = 0;

      // Boost client-specific results (strong preference for active client)
      var rowClient = (row.metadata && row.metadata.client) ? row.metadata.client : null;
      if (rowClient && rowClient === self.activeClient) {
        score += 20; // Big boost for matching client
      } else if (rowClient && rowClient !== self.activeClient && self.activeClient !== 'generic') {
        score -= 5; // Penalize wrong client (unless we're on generic)
      }
      // Core frameworks (no client tag) always score normally

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

    // Sort by score and return top matches
    scored.sort(function(a, b) { return b._score - a._score; });
    return scored.slice(0, matchCount).filter(function(r) { return r._score > 0; });
  }

  // Search by category
  async getByCategory(category, limit) {
    limit = limit || 10;
    var result = await this.supabase
      .from('knowledge_base')
      .select('*')
      .eq('category', category)
      .limit(limit);

    return result.data || [];
  }

  // Add a new entry to the knowledge base
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

    // Try to generate embedding
    var embedding = await this.getEmbedding(label + ' ' + content);
    if (embedding) {
      entry.embedding = embedding;
    }

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
