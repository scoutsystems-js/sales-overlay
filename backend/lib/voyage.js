// lib/voyage.js — the single Voyage embedding call.
//
// Extracted from routes/kb.js in KB Part 2 sub-stage 2d, because the analysis
// worker now needs embeddings too (auto-population) and a second copy of this
// function in the worker would be exactly the kind of duplication 2a spent its
// budget retiring. One implementation, two callers.
//
// NEVER throws. Returns the vector, or null on missing key / HTTP failure /
// network error / malformed response. Callers decide what a null means:
//   • /kb/upload stores the chunk with embedding null — still reachable via the
//     keyword-search fallback.
//   • harvested moments store null too — the row is still a real KB entry.
// Embedding availability must never be the thing that fails a write.

var VOYAGE_MODEL = 'voyage-3-lite'; // 512-dim; matches every existing row

async function getVoyageEmbedding(text, label) {
  var tag = label || 'kb';
  if (!process.env.VOYAGE_API_KEY) {
    console.error('[' + tag + '] VOYAGE_API_KEY not configured — embedding skipped');
    return null;
  }
  try {
    var res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.VOYAGE_API_KEY,
      },
      body: JSON.stringify({ input: [text], model: VOYAGE_MODEL }),
    });
    if (!res.ok) {
      console.error('[' + tag + '] Voyage embedding failed: HTTP ' + res.status);
      return null;
    }
    var data = await res.json();
    return (data.data && data.data[0] && data.data[0].embedding) || null;
  } catch (err) {
    console.error('[' + tag + '] Voyage embedding error:', err.message);
    return null;
  }
}

// Batch embed. ONE request for many texts, returning an array the SAME LENGTH
// as the input where each slot is a vector or null.
//
// ── Why this exists (defect found 2026-08-03) ─────────────────────────────
// KB harvesting used to call getVoyageEmbedding once per moment, sequentially.
// The first in-situ run embedded 3 of 5 and then took HTTP 429 on the last two,
// which stored with embedding null. Adding a delay would only slow the pass and
// still rate-limit at scale — and, worse, it would NOT remove the systematic
// bias: selectHarvestMoments preserves chronological order, so the dropouts are
// always the late-call sections (`close` above all), precisely the moments a
// "how do I close" semantic search needs to find. One request removes the
// per-item limit exposure entirely.
//
// ── Contract ──────────────────────────────────────────────────────────────
// • Output length ALWAYS equals input length. Callers index into it positionally.
// • Mapping uses the response's `index` field, never array order — trusting
//   order would silently attach the wrong vector to the wrong moment, a
//   corruption invisible until search results stopped making sense.
// • PARTIAL failure degrades per-item to null; TOTAL failure degrades to
//   all-nulls. Never throws, never returns a short array. A batch error must
//   never lose the harvest — every row stays writable, just unembedded.
async function getVoyageEmbeddings(texts, label) {
  var tag = label || 'kb';
  if (!Array.isArray(texts) || texts.length === 0) return [];
  var out = new Array(texts.length).fill(null);

  if (!process.env.VOYAGE_API_KEY) {
    console.error('[' + tag + '] VOYAGE_API_KEY not configured — batch embedding skipped');
    return out;
  }
  try {
    var res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.VOYAGE_API_KEY,
      },
      body: JSON.stringify({ input: texts, model: VOYAGE_MODEL }),
    });
    if (!res.ok) {
      console.error('[' + tag + '] Voyage batch embedding failed: HTTP ' + res.status + ' (' + texts.length + ' texts)');
      return out;
    }
    var data = await res.json();
    if (!data || !Array.isArray(data.data)) {
      console.error('[' + tag + '] Voyage batch embedding: unexpected response shape');
      return out;
    }
    for (var i = 0; i < data.data.length; i++) {
      var item = data.data[i];
      if (!item || typeof item.index !== 'number') continue;
      if (item.index < 0 || item.index >= out.length) continue;   // never write past the end
      if (!Array.isArray(item.embedding)) continue;               // malformed → stays null
      out[item.index] = item.embedding;
    }
    var missing = out.filter(function (v) { return v === null; }).length;
    if (missing > 0) {
      console.warn('[' + tag + '] Voyage batch returned ' + (out.length - missing) + '/' + out.length + ' embeddings');
    }
    return out;
  } catch (err) {
    console.error('[' + tag + '] Voyage batch embedding error:', err.message);
    return out;
  }
}

module.exports = {
  getVoyageEmbedding: getVoyageEmbedding,
  getVoyageEmbeddings: getVoyageEmbeddings,
  VOYAGE_MODEL: VOYAGE_MODEL,
};
