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
const { TEAM_KEY_COLUMN } = require('./kb-scope');
const { allocate, usableProfileField, chunkForContext } = require('./selling-budget');

// GRADER context = the closer's offer + approach material (excludes winning_call
// transcripts + training_material, which are synthesis-side). SYNTHESIS context
// adds winning_call + training_material on top. Callers pass the set they want;
// grader uses the default. (Seeded framework entries never match: they carry the
// `category` column value, not category='user_upload' + metadata.category.)
var GRADER_CATEGORIES = ['script', 'offer_document', 'objection_framework', 'case_study'];
var SYNTHESIS_CATEGORIES = GRADER_CATEGORIES.concat(['winning_call', 'training_material']);
var DEFAULT_MAX_CHARS = 5000;

async function fetchSellingContext(admin, userId, maxChars, categories) {
  var cap = maxChars || DEFAULT_MAX_CHARS;
  var cats = (Array.isArray(categories) && categories.length) ? categories : GRADER_CATEGORIES;
  try {
    // The ONBOARDING-WIZARD material. user_profiles.offer / qualifications /
    // script_raw were written by the old onboarding wizard and the desktop
    // script upload, and lived in a table the grader never read — so every
    // grade to date was scored against generic standards while the closer's
    // actual criteria ("10k saved, not living paycheck to paycheck, 640 or
    // above credit score") sat one table away. Wiring them in is an INPUT
    // change: the SELLING CONTEXT prompt block already existed and is unchanged.
    var prof = await admin.from('user_profiles')
      .select('managed_by, niche, offer, qualifications, script_raw')
      .eq('user_id', userId).maybeSingle();
    var pdata = (prof && prof.data) || {};
    var managedBy = pdata.managed_by || null;

    var cols = 'id, label, scope, uploaded_by, content, metadata, created_at';
    function base() {
      return admin.from('knowledge_base').select(cols)
        .eq('category', 'user_upload').in('metadata->>category', cats);
    }
    // Precedence unchanged: personal uploads apply ONLY to UNMANAGED users; a
    // managed user's coaching is governed by their manager's team KB.
    var personal = managedBy ? { data: [] } : await base().eq('uploaded_by', userId);
    var team = managedBy ? await base().eq(TEAM_KEY_COLUMN, managedBy).eq('scope', 'team') : { data: [] };
    var global = await base().eq('scope', 'global');
    if (personal.error) throw new Error('personal: ' + personal.error.message);
    if (team.error) throw new Error('team: ' + team.error.message);
    if (global.error) throw new Error('global: ' + global.error.message);

    // ── Build the lanes ──────────────────────────────────────────────────
    // usableProfileField rejects stray values — the demo accounts store
    // offer = "Ava"/"Ben"/"Cara", which must never reach the grader as an offer.
    var qualChunks = [], offerChunks = [], scriptChunks = [];
    if (usableProfileField(pdata.qualifications)) {
      qualChunks = chunkForContext('QUALIFYING CRITERIA for this offer (the bar a prospect must clear): ' + pdata.qualifications.trim());
    }
    var offerParts = [];
    if (usableProfileField(pdata.niche)) offerParts.push('NICHE: ' + pdata.niche.trim());
    if (usableProfileField(pdata.offer)) offerParts.push('OFFER: ' + pdata.offer.trim());
    if (offerParts.length) offerChunks = chunkForContext(offerParts.join('\n'));
    if (usableProfileField(pdata.script_raw, 200)) {
      scriptChunks = chunkForContext("THE CLOSER'S OWN CALL SCRIPT (their intended questions and framing):\n" + pdata.script_raw.trim());
    }

    // KB uploads, deduped across scopes, personal → team → global.
    var seen = {}, kbChunks = [], kbUsed = [], kbSources = {};
    function addKb(rows) {
      (rows || []).forEach(function (r) {
        if (seen[r.id]) return; seen[r.id] = true;
        kbChunks.push(r.content || '');
        kbUsed.push(r);
        kbSources[r.label || r.id] = true;
      });
    }
    addKb(personal.data); addKb(team.data); addKb(global.data);

    var lanes = [
      { key: 'qualifications', priority: 1, reserve: 600,  chunks: qualChunks },
      { key: 'offer',          priority: 2, reserve: 900,  chunks: offerChunks },
      { key: 'script',         priority: 3, reserve: 1500, chunks: scriptChunks },
      { key: 'kb',             priority: 4, reserve: 1500, chunks: kbChunks },
    ];
    var picked = allocate(lanes, cap);

    var out = [], sourceSummary = [];
    ['qualifications', 'offer', 'script', 'kb'].forEach(function (k) {
      var got = picked[k] || [];
      if (!got.length) return;
      got.forEach(function (c) { out.push(c); });
      sourceSummary.push({
        label: k, group: (k === 'kb') ? 'knowledge_base' : 'profile',
        chunks_total: lanes.filter(function (l) { return l.key === k; })[0].chunks.length,
        chunks_used: got.length,
        chars: got.reduce(function (n, c) { return n + c.length; }, 0),
      });
    });
    if (!out.length) return { contextText: '', kbHash: 'none', sources: [] };

    var contextText = out.join('\n\n');
    // Hash covers BOTH sources so a profile edit invalidates cached syntheses
    // exactly as a KB upload does. KB rows hash by id+created_at as before;
    // profile material hashes by content, since it has no row identity here.
    var hashParts = kbUsed.map(function (r) { return r.id + ':' + (r.created_at || ''); }).sort();
    ['qualifications', 'offer', 'script'].forEach(function (k) {
      (picked[k] || []).forEach(function (c) { hashParts.push(k + ':' + crypto.createHash('sha1').update(c).digest('hex')); });
    });
    var kbHash = hashParts.length
      ? crypto.createHash('sha1').update(hashParts.join('|')).digest('hex')
      : 'none';
    return { contextText: contextText, kbHash: kbHash, sources: sourceSummary };
  } catch (err) {
    console.error('[selling-context] fetch failed for user ' + userId + ' — returning empty: ' + (err && err.message));
    return { contextText: '', kbHash: 'none', sources: [] };
  }
}

module.exports = { fetchSellingContext: fetchSellingContext, GRADER_CATEGORIES: GRADER_CATEGORIES, SYNTHESIS_CATEGORIES: SYNTHESIS_CATEGORIES };
