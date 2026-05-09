const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth, requireSubscription } = require('../middleware/auth');

var router = express.Router();

// Service-role client: bypasses RLS for KB inserts/queries. The four routes
// here enforce visibility/ownership in SQL/JS rather than via RLS — see
// migration 006 for the scoping rules and the route handlers below for
// per-route enforcement.
var _admin = null;
function getAdminClient() {
  if (_admin) return _admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

function handleConfigError(err, res) {
  if (err.message && err.message.indexOf('not configured') !== -1) {
    console.error('[kb] Config error:', err.message);
    res.status(503).json({ error: err.message });
    return true;
  }
  return false;
}

var protect = [requireAuth, requireSubscription];

// Multer with memory storage — uploads stay in RAM, never hit Railway's
// filesystem. 10MB per file cap matches the spec.
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── Helpers ──────────────────────────────────────────────────────────────

// Single Voyage REST call. Returns the embedding vector or null on any
// failure. Never throws — the caller decides what to do without an embedding
// (search falls back to keyword scoring, upload still inserts the chunk).
async function getVoyageEmbedding(text) {
  if (!process.env.VOYAGE_API_KEY) {
    console.error('[kb] VOYAGE_API_KEY not configured — embedding skipped');
    return null;
  }
  try {
    var res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.VOYAGE_API_KEY,
      },
      body: JSON.stringify({ input: [text], model: 'voyage-3-lite' }),
    });
    if (!res.ok) {
      console.error('[kb] Voyage embedding failed: HTTP ' + res.status);
      return null;
    }
    var data = await res.json();
    return (data.data && data.data[0] && data.data[0].embedding) || null;
  } catch (err) {
    console.error('[kb] Voyage embedding error:', err.message);
    return null;
  }
}

// Resolve the caller's role + team relationships in one trip. Returns
// { role, managed_by, p_user_id, p_admin_id } where p_admin_id =
// caller's id if admin/owner (they own team uploads themselves), else
// their managed_by (admin they belong to).
async function resolveUserScope(adminClient, userId) {
  var profile = await adminClient
    .from('user_profiles')
    .select('role, managed_by')
    .eq('user_id', userId)
    .maybeSingle();
  var role = (profile.data && profile.data.role) || 'user';
  var managed_by = (profile.data && profile.data.managed_by) || null;
  var p_admin_id;
  if (role === 'admin' || role === 'owner') {
    p_admin_id = userId;
  } else {
    p_admin_id = managed_by;
  }
  return { role: role, managed_by: managed_by, p_user_id: userId, p_admin_id: p_admin_id };
}

// Returns the set of user_ids whose uploads the caller can list/delete.
// null = no filter (owners see every uploaded entry that isn't seeded).
async function getVisibleUploaderIds(adminClient, userId, role) {
  if (role === 'owner') return null;
  var ids = [userId];
  if (role === 'admin') {
    var managed = await adminClient
      .from('user_profiles')
      .select('user_id')
      .eq('managed_by', userId);
    if (managed.data) {
      for (var i = 0; i < managed.data.length; i++) {
        if (managed.data[i].user_id) ids.push(managed.data[i].user_id);
      }
    }
  }
  return ids;
}

// Strip HTML to plain text. Removes script/style/noscript/nav/header/footer/
// aside blocks first (common boilerplate that bloats chunks with menus and
// site chrome), then strips remaining tags, decodes the most common HTML
// entities, and collapses whitespace.
function stripHtml(html) {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPageTitle(html) {
  var m = String(html || '').match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

// Chunk plain text into ~500-word segments with ~50-word overlap. Drops a
// trailing chunk shorter than 50 words to avoid embedding tiny dangling
// fragments that wouldn't carry useful semantics.
var CHUNK_WORDS = 500;
var CHUNK_OVERLAP = 50;
function chunkText(text) {
  var words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= CHUNK_WORDS) return [words.join(' ')];
  var chunks = [];
  var stride = CHUNK_WORDS - CHUNK_OVERLAP;
  for (var i = 0; i < words.length; i += stride) {
    var slice = words.slice(i, i + CHUNK_WORDS);
    if (slice.length < 50 && chunks.length > 0) break;
    chunks.push(slice.join(' '));
    if (i + CHUNK_WORDS >= words.length) break;
  }
  return chunks;
}

// Transcript-aware chunking. Detects speaker turns at line starts (CLOSER:,
// PROSPECT:, Speaker 1:, Agent:, etc.) and groups TURNS_PER_CHUNK turns per
// chunk with TURN_OVERLAP turns of overlap between adjacent chunks. Falls
// back to fixed-word chunkText() if the content doesn't look like a real
// transcript (fewer than 4 detected turns) — protects against pasting
// random prose into the "Winning call transcript" category.
//
// Trailing partial chunks are kept (unlike chunkText's <50-word drop)
// because a 2- or 3-turn final exchange in a sales call often contains
// the close itself, which is the most valuable part of the transcript.
var SPEAKER_RE = /^(?:[A-Z]{2,}|[A-Z][a-z]+(?:\s+\d+)?):\s/;
var TURNS_PER_CHUNK = 5;
var TURN_OVERLAP = 2;
function chunkTranscript(text) {
  var lines = String(text || '').split(/\r?\n/);
  var turns = [];
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (SPEAKER_RE.test(trimmed)) {
      if (current) turns.push(current);
      current = trimmed;
    } else if (current) {
      // Continuation of the current speaker's turn (multi-line utterance).
      current += ' ' + trimmed;
    }
    // Lines before the first speaker tag are dropped — usually transcript
    // headers ("Recorded 2026-04-15", "Duration 47:12", etc.) that would
    // pollute the embedding if attached to whoever spoke first.
  }
  if (current) turns.push(current);

  if (turns.length < 4) return chunkText(text);

  var chunks = [];
  var stride = TURNS_PER_CHUNK - TURN_OVERLAP; // 3 — turn N's last 2 reappear as N+1's first 2
  for (var j = 0; j < turns.length; j += stride) {
    var slice = turns.slice(j, j + TURNS_PER_CHUNK);
    if (slice.length === 0) break;
    chunks.push(slice.join('\n'));
    if (j + TURNS_PER_CHUNK >= turns.length) break;
  }
  return chunks;
}

// Result merging on search — three-tier priority:
//   Tier 1: learned_pattern entries (auto-extracted high-signal moments
//           from the closer's own past calls). These are the most
//           specific signal the system has and lead every result set
//           when present.
//   Tier 2: other user uploads (offer documents, winning-call transcripts,
//           etc.). The closer's curated reference material.
//   Tier 3: seeded frameworks (uploaded_by IS NULL — the universal sales
//           frameworks shipped with the app). Default fallback when the
//           upper tiers don't fill the result set.
//
// Slots fill top-down: Tier 1 fills first up to matchCount, Tier 2 takes
// any remainder, Tier 3 backfills whatever's still left. Final array is
// re-sorted by similarity desc so the most relevant entry leads regardless
// of which tier it came from. Tier 3 fallback (no Tier 1, no Tier 2) is
// preserved unchanged from the prior two-tier logic.
//
// Inputs are already sorted by similarity (or _score for keyword path)
// descending. Result length never exceeds matchCount.
function enforceDiversity(rows, matchCount) {
  var learned = [];
  var uploads = [];
  var framework = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.uploaded_by === null || r.uploaded_by === undefined) {
      framework.push(r);
    } else if (r.category === 'learned_pattern') {
      learned.push(r);
    } else {
      uploads.push(r);
    }
  }

  // Pure Tier 3 fallback — preserves prior behavior on KBs with no user
  // content at all (most common when a brand-new user runs their first call).
  if (learned.length === 0 && uploads.length === 0) {
    return framework.slice(0, matchCount);
  }

  var picked = [];
  var remaining = matchCount;
  if (remaining > 0 && learned.length > 0) {
    var takeL = Math.min(learned.length, remaining);
    picked = picked.concat(learned.slice(0, takeL));
    remaining -= takeL;
  }
  if (remaining > 0 && uploads.length > 0) {
    var takeU = Math.min(uploads.length, remaining);
    picked = picked.concat(uploads.slice(0, takeU));
    remaining -= takeU;
  }
  if (remaining > 0 && framework.length > 0) {
    picked = picked.concat(framework.slice(0, remaining));
  }

  picked.sort(function(a, b) {
    var sa = (typeof a.similarity === 'number') ? a.similarity : (a._score || 0);
    var sb = (typeof b.similarity === 'number') ? b.similarity : (b._score || 0);
    return sb - sa;
  });
  return picked;
}

// ── POST /kb/search ──────────────────────────────────────────────────────
// Desktop app's KnowledgeBase.search() calls here. Voyage embedding +
// match_knowledge RPC if VOYAGE_API_KEY is set; falls through to scoped
// keyword search if Voyage 401s/network-fails/returns no hits.
router.post('/search', protect, async function(req, res) {
  var query = req.body && req.body.query;
  var matchCount = req.body && req.body.matchCount;
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query required' });
  }
  matchCount = (typeof matchCount === 'number' && matchCount > 0) ? Math.min(matchCount, 50) : 5;

  try {
    var admin = getAdminClient();
    var scope = await resolveUserScope(admin, req.user.id);

    var embedding = await getVoyageEmbedding(query);
    if (embedding) {
      // Request matchCount+3 so enforceDiversity has room to swap in a
      // framework entry without truncating the user-upload tail too early.
      var rpc = await admin.rpc('match_knowledge', {
        query_embedding: embedding,
        match_threshold: 0.5,
        match_count: matchCount + 3,
        p_user_id: scope.p_user_id,
        p_admin_id: scope.p_admin_id,
      });
      if (!rpc.error && rpc.data && rpc.data.length > 0) {
        var diverse = enforceDiversity(rpc.data, matchCount);
        return res.json({ results: diverse, source: 'embedding' });
      }
      if (rpc.error) {
        console.error('[kb] match_knowledge RPC failed:', rpc.error.message);
      }
    }

    // Fallback path: fetch up to 200 candidates, filter by scope in JS,
    // score by trigger/label/content overlap. Mirrors the existing
    // searchByText scoring weights from src/ai/knowledge-base.js so
    // behavior is consistent with what the desktop app used to do directly.
    var rows = await admin
      .from('knowledge_base')
      .select('id, category, label, content, triggers, metadata, uploaded_by, scope')
      .limit(200);
    if (rows.error) {
      console.error('[kb] fallback fetch failed:', rows.error.message);
      return res.json({ results: [], source: 'fallback-empty' });
    }

    var visible = (rows.data || []).filter(function(row) {
      if (row.uploaded_by === null || row.uploaded_by === undefined) return true;
      if (row.scope === 'global') return true;
      if (row.scope === 'personal' && row.uploaded_by === scope.p_user_id) return true;
      if (row.scope === 'team' && scope.p_admin_id && row.uploaded_by === scope.p_admin_id) return true;
      return false;
    });

    var lower = query.toLowerCase();
    var queryWords = lower.split(/\s+/).filter(function(w) { return w.length > 3; });
    var scored = visible.map(function(row) {
      var s = 0;
      if (row.triggers && Array.isArray(row.triggers)) {
        for (var i = 0; i < row.triggers.length; i++) {
          if (lower.indexOf(String(row.triggers[i]).toLowerCase()) !== -1) s += 10;
        }
      }
      if (row.label && lower.indexOf(row.label.toLowerCase()) !== -1) s += 5;
      var contentLower = (row.content || '').toLowerCase();
      for (var j = 0; j < queryWords.length; j++) {
        if (contentLower.indexOf(queryWords[j]) !== -1) s += 1;
      }
      row._score = s;
      return row;
    });
    scored.sort(function(a, b) { return b._score - a._score; });
    // Pull matchCount+3 candidates so enforceDiversity has the same swap
    // room the embedding path gets.
    var top = scored.slice(0, matchCount + 3).filter(function(r) { return r._score > 0; });
    var diverse = enforceDiversity(top, matchCount);
    return res.json({ results: diverse, source: 'keyword' });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[kb] search error:', err.message);
    return res.json({ results: [], source: 'error', error: err.message });
  }
});

// ── POST /kb/upload ──────────────────────────────────────────────────────
// Multipart: type='url'|'pdf'|'paste', plus the corresponding payload.
// Extracts text → chunks → embeds → bulk inserts. Embedding failures are
// per-chunk non-fatal so a Voyage outage doesn't abort the whole upload.
router.post('/upload', protect, upload.single('file'), async function(req, res) {
  var type = req.body && req.body.type;
  var providedLabel = (req.body && req.body.label) ? String(req.body.label).trim() : '';
  // Category drives chunking strategy: winning_call → chunkTranscript()
  // (speaker-turn aware), offer_document → chunkText() (fixed word count).
  // Default to offer_document for backwards-compat with any client that
  // hasn't been updated to send category yet.
  var category = (req.body && req.body.category) || 'offer_document';
  if (['offer_document', 'winning_call'].indexOf(category) === -1) {
    category = 'offer_document';
  }
  if (!type || ['url', 'pdf', 'paste'].indexOf(type) === -1) {
    return res.status(400).json({ error: "type must be 'url' | 'pdf' | 'paste'" });
  }

  try {
    var admin = getAdminClient();
    var scope = await resolveUserScope(admin, req.user.id);

    // Map role → upload scope (owner→global, admin→team, user→personal)
    var uploadScope;
    if (scope.role === 'owner') uploadScope = 'global';
    else if (scope.role === 'admin') uploadScope = 'team';
    else uploadScope = 'personal';

    var text = '';
    var sourceLabel = providedLabel;
    var sourceMeta = { source_type: type };

    if (type === 'paste') {
      text = (req.body.text || '').trim();
      if (!text) return res.status(400).json({ error: 'text required for paste type' });
      if (!sourceLabel) sourceLabel = 'Paste ' + new Date().toISOString().slice(0, 10);
    } else if (type === 'url') {
      var url = (req.body.url || '').trim();
      if (!url) return res.status(400).json({ error: 'url required for url type' });
      sourceMeta.source_url = url;
      var fetchRes;
      try {
        fetchRes = await fetch(url, { redirect: 'follow' });
      } catch (err) {
        return res.status(400).json({ error: 'Could not fetch URL: ' + err.message });
      }
      if (!fetchRes.ok) {
        return res.status(400).json({ error: 'URL fetch returned HTTP ' + fetchRes.status });
      }
      var html = await fetchRes.text();
      text = stripHtml(html);
      if (!sourceLabel) {
        sourceLabel = extractPageTitle(html) || url;
      }
    } else if (type === 'pdf') {
      if (!req.file) return res.status(400).json({ error: 'file required for pdf type' });
      sourceMeta.filename = req.file.originalname || 'upload.pdf';
      try {
        var pdf = await pdfParse(req.file.buffer);
        text = pdf.text || '';
      } catch (err) {
        return res.status(400).json({ error: 'PDF parse failed: ' + err.message });
      }
      if (!sourceLabel) sourceLabel = req.file.originalname || 'PDF Upload';
    }

    text = text.trim();
    if (!text) return res.status(400).json({ error: 'No text extracted from source' });

    // Pick the chunker based on category. chunkTranscript falls back to
    // chunkText internally if it can't detect speaker turns, so a mis-
    // tagged transcript still produces usable chunks.
    var chunks = (category === 'winning_call') ? chunkTranscript(text) : chunkText(text);
    if (chunks.length === 0) return res.status(400).json({ error: 'No usable chunks produced' });

    // Generate embeddings sequentially. Per-chunk failure is non-fatal —
    // chunk gets stored with embedding: null and stays findable via the
    // /kb/search keyword fallback.
    var rows = [];
    for (var i = 0; i < chunks.length; i++) {
      var emb = await getVoyageEmbedding(chunks[i]);
      var chunkMeta = Object.assign({}, sourceMeta, {
        category: category,
        chunk_index: i,
        total_chunks: chunks.length,
      });
      rows.push({
        category: 'user_upload',
        label: sourceLabel,
        content: chunks[i],
        triggers: [],
        metadata: chunkMeta,
        embedding: emb,
        uploaded_by: req.user.id,
        scope: uploadScope,
        source_label: sourceLabel,
      });
    }

    var insert = await admin.from('knowledge_base').insert(rows);
    if (insert.error) {
      var detail = String(insert.error.message || 'unknown').slice(0, 200);
      console.error('[kb] upload insert failed:', detail);
      return res.status(500).json({ error: 'Could not save upload: ' + detail });
    }

    console.log('[kb] Upload saved: actor=%s scope=%s label=%s chunks=%d',
      req.user.email, uploadScope, sourceLabel, rows.length);
    return res.json({ ok: true, chunks: rows.length });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[kb] upload error:', err.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// ── POST /kb/store-patterns ───────────────────────────────────────────────
// Adaptive learning: bulk-insert auto-extracted "high signal" moments from
// a finished call. Called only by the desktop's stop-session flow after
// /proxy/extract-patterns returns a non-empty array. JSON body, no multer,
// no chunking — patterns arrive pre-formed and go straight to KB rows.
//
// Errors never propagate to the caller — this is fire-and-forget from the
// desktop. Bad inputs and Supabase failures both resolve to a 200 with
// stored:0 so the desktop's promise resolves cleanly.
router.post('/store-patterns', protect, async function(req, res) {
  var patterns = req.body && req.body.patterns;
  var sourceLabel = (req.body && req.body.sourceLabel) ? String(req.body.sourceLabel).trim() : '';

  if (!Array.isArray(patterns) || patterns.length === 0) {
    return res.json({ ok: true, stored: 0 });
  }
  if (!sourceLabel) {
    sourceLabel = 'Learned — ' + new Date().toISOString().slice(0, 10);
  }

  try {
    var admin = getAdminClient();
    var rows = [];
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i] || {};
      var situation = String(p.situation || '').trim();
      var response  = String(p.response  || '').trim();
      var outcome   = String(p.outcome   || '').trim();
      var type      = String(p.type      || '').trim();
      // Skip patterns missing the core fields — better to drop than store a
      // half-formed entry that'll surface in search with empty quotes.
      if (!situation || !response) continue;

      var content = 'When ' + situation + ', closer responded: "' + response + '". Prospect reaction: ' + (outcome || '(unspecified)') + '.';
      var emb = await getVoyageEmbedding(content);

      rows.push({
        category: 'learned_pattern',
        label: sourceLabel,
        content: content,
        triggers: [],
        metadata: {
          category: 'learned_pattern',
          type: type,
          situation: situation,
          response: response,
          outcome: outcome,
          source: 'auto_extracted',
        },
        embedding: emb,
        uploaded_by: req.user.id,
        scope: 'personal',
        source_label: sourceLabel,
      });
    }

    if (rows.length === 0) {
      return res.json({ ok: true, stored: 0 });
    }

    var insert = await admin.from('knowledge_base').insert(rows);
    if (insert.error) {
      console.error('[kb] store-patterns insert failed:', String(insert.error.message || 'unknown').slice(0, 200));
      return res.json({ ok: true, stored: 0 });
    }
    console.log('[kb] Patterns stored: actor=%s label=%s count=%d', req.user.email, sourceLabel, rows.length);
    return res.json({ ok: true, stored: rows.length });
  } catch (err) {
    // Fire-and-forget — log and degrade. Caller already moved on.
    console.error('[kb] store-patterns error:', err.message);
    return res.json({ ok: true, stored: 0 });
  }
});

// ── GET /kb/list ──────────────────────────────────────────────────────────
// Lists uploads visible to the caller, grouped by source_label. Users see
// their own. Admins see their own + their managed users'. Owners see every
// uploaded entry (all rows where uploaded_by is not null).
router.get('/list', protect, async function(req, res) {
  try {
    var admin = getAdminClient();
    var scope = await resolveUserScope(admin, req.user.id);
    var visibleIds = await getVisibleUploaderIds(admin, req.user.id, scope.role);

    var query = admin
      .from('knowledge_base')
      .select('source_label, scope, metadata, created_at, uploaded_by')
      .not('uploaded_by', 'is', null)
      .order('created_at', { ascending: false });
    if (visibleIds !== null) query = query.in('uploaded_by', visibleIds);

    var result = await query;
    if (result.error) {
      console.error('[kb] list query failed:', result.error.message);
      return res.status(500).json({ error: 'Could not list uploads' });
    }

    // Group rows by source_label; chunk_count = per-group row count;
    // created_at = earliest (the upload moment, not the last chunk).
    var groups = {};
    var rowsArr = result.data || [];
    for (var i = 0; i < rowsArr.length; i++) {
      var row = rowsArr[i];
      var key = row.source_label || '(unlabeled)';
      if (!groups[key]) {
        groups[key] = {
          source_label: key,
          source_type: (row.metadata && row.metadata.source_type) || null,
          // Surface category so the frontend can render the offer-doc /
          // winning-call badge. Pre-this-feature uploads don't have it
          // and will simply not show a category badge.
          category: (row.metadata && row.metadata.category) || null,
          chunk_count: 0,
          created_at: row.created_at,
          scope: row.scope,
        };
      }
      groups[key].chunk_count += 1;
      if (row.created_at && row.created_at < groups[key].created_at) {
        groups[key].created_at = row.created_at;
      }
    }

    var uploads = Object.keys(groups).map(function(k) { return groups[k]; });
    return res.json({ uploads: uploads });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[kb] list error:', err.message);
    return res.status(500).json({ error: 'Failed to list uploads' });
  }
});

// ── GET /kb/entries/:source_label ─────────────────────────────────────────
// Returns the individual chunks for a given upload, in chunk order. Used by
// the dashboard / admin "View patterns" expand panel to surface each
// learned_pattern's situation/response/outcome metadata. Scoping mirrors
// /list: regular users only see their own entries, admins see their team,
// owners see all uploaded entries (uploaded_by IS NOT NULL only — never
// seeded framework rows). Empty result returns 200 with entries:[] rather
// than 404 so the frontend can show a clean "no patterns" state.
router.get('/entries/:source_label', protect, async function(req, res) {
  var sourceLabel = decodeURIComponent(req.params.source_label || '');
  if (!sourceLabel) return res.status(400).json({ error: 'source_label required' });

  try {
    var admin = getAdminClient();
    var scope = await resolveUserScope(admin, req.user.id);
    var visibleIds = await getVisibleUploaderIds(admin, req.user.id, scope.role);

    var query = admin
      .from('knowledge_base')
      .select('id, content, metadata, category, created_at, scope')
      .eq('source_label', sourceLabel)
      .not('uploaded_by', 'is', null)
      .order('created_at', { ascending: true });
    if (visibleIds !== null) query = query.in('uploaded_by', visibleIds);

    var result = await query;
    if (result.error) {
      console.error('[kb] entries query failed:', result.error.message);
      return res.status(500).json({ error: 'Could not load entries' });
    }
    return res.json({ entries: result.data || [] });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[kb] entries error:', err.message);
    return res.status(500).json({ error: 'Failed to load entries' });
  }
});

// ── DELETE /kb/:source_label ──────────────────────────────────────────────
// Deletes every chunk with a given source_label. Always scoped: even owners
// can't delete seeded entries (uploaded_by IS NULL). Admins can delete their
// managed users' uploads; owners can delete any uploaded entry.
router.delete('/:source_label', protect, async function(req, res) {
  var sourceLabel = decodeURIComponent(req.params.source_label || '');
  if (!sourceLabel) return res.status(400).json({ error: 'source_label required' });

  try {
    var admin = getAdminClient();
    var scope = await resolveUserScope(admin, req.user.id);
    var visibleIds = await getVisibleUploaderIds(admin, req.user.id, scope.role);

    var del = admin
      .from('knowledge_base')
      .delete({ count: 'exact' })
      .eq('source_label', sourceLabel)
      .not('uploaded_by', 'is', null);
    if (visibleIds !== null) del = del.in('uploaded_by', visibleIds);

    var result = await del;
    if (result.error) {
      console.error('[kb] delete failed:', result.error.message);
      return res.status(500).json({ error: 'Could not delete upload' });
    }

    var deleted = (typeof result.count === 'number') ? result.count : 0;
    console.log('[kb] Upload deleted: actor=%s label=%s rows=%d',
      req.user.email, sourceLabel, deleted);
    return res.json({ ok: true, deleted: deleted });
  } catch (err) {
    if (handleConfigError(err, res)) return;
    console.error('[kb] delete error:', err.message);
    return res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
