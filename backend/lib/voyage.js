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

module.exports = { getVoyageEmbedding: getVoyageEmbedding, VOYAGE_MODEL: VOYAGE_MODEL };
