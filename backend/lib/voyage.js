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

// ── WHY THERE IS A RETRY HERE (diagnosed 2026-08-29) ──────────────────────
// 386 of 1,625 harvested moments carried no embedding, and the obvious story —
// "rate limiting under sustained grading" — was only half right and was NOT the
// live fault. Measured, there were THREE separate populations:
//
//   84 rows (28-29 Aug)  the harvest ran in a LOCAL shell with no
//                        VOYAGE_API_KEY. TOTAL failure per call, and the
//                        embedded/null boundary flips four minutes apart —
//                        which no rate limit does, but two execution
//                        environments do. NOT a production fault.
//   299 rows (25-26 Aug) PARTIAL failure (26% and 32%) during heavy concurrent
//                        grading on Railway. Consistent with rate limiting;
//                        ⚠ NOT provable from logs, whose retention no longer
//                        covers those days. This retry is aimed at it.
//   170 seeded rows      a DIFFERENT fault entirely — scripts/seed-frameworks.js
//                        contains no embedding code at all, so those April rows
//                        never had one. A retry cannot help them; only a
//                        backfill can.
//
// ⚠ THE DEGRADE STAYS CORRECT. A row must still be written unembedded rather
// than lost — that is why the harvest survived all three of these. What was
// missing was any attempt to recover a transient failure, and any way to SEE a
// persistent one.

var VOYAGE_MODEL = 'voyage-3-lite'; // 512-dim; matches every existing row

/* Reused, not re-declared. lib/model-retry already decides which HTTP statuses
   will not improve on their own, and a second list here would be free to drift
   from it — the exact duplication the shared-constants work exists to retire.
   ⚠ We reuse the CLASSIFICATION only. model-retry's other half counts attempts
   ACROSS analysis runs to requeue a row; this is an INLINE retry inside one
   request. Same question, different mechanism. */
var { PERMANENT_STATUSES } = require('./model-retry');

/** 3 attempts per page. Bounded deliberately: past this a 429 is not a blip,
 *  and every extra attempt delays an upload the caller is waiting on.
 *
 *  ⚠⚠ A CALLER MAY ASK FOR ONE ATTEMPT, AND BULK WORK SHOULD. Measured against
 *  the live 3 RPM ceiling: a page's three attempts fire inside ~1.5s and eat the
 *  WHOLE minute's request budget, so the next page 429s even when it is paced
 *  20s later. Under a per-minute REQUEST ceiling an inline retry is not merely
 *  useless, it is actively counterproductive — it converts one failed page into
 *  two. The request path still wants the retry (a genuine blip clears in
 *  milliseconds); a paced backfill wants a single attempt and another pass. */
var MAX_EMBED_ATTEMPTS = 3;

/** Honour the provider's own Retry-After when it sends one, else back off
 *  exponentially. Capped so a hostile header cannot stall a request path. */
var MAX_BACKOFF_MS = 4000;

function backoffMs(res, attempt) {
  var hdr = res && res.headers && res.headers.get && res.headers.get('retry-after');
  var secs = hdr ? Number(hdr) : NaN;
  if (isFinite(secs) && secs > 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  return Math.min(500 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** 'temporary' | 'permanent' for an HTTP status we hold directly. */
function classifyEmbedStatus(status) {
  return PERMANENT_STATUSES.indexOf(status) !== -1 ? 'permanent' : 'temporary';
}

/**
 * Can this process embed at all?
 *
 * ⚠⚠ THIS IS THE ONE THAT WOULD HAVE PREVENTED THE 84. A missing key is not a
 * transient failure to be retried — it is a GUARANTEED total failure for every
 * row, and it is invisible because the degrade is correct. A batch runner must
 * call this and REFUSE TO START rather than discover it one call at a time.
 * Same shape as the Zoom capability abort: a local run inherits the local
 * environment's capabilities, and must check them before spending.
 */
function embeddingCapability() {
  if (!process.env.VOYAGE_API_KEY) {
    return { ok: false, reason: 'VOYAGE_API_KEY is not set in this environment — every row would be written unembedded' };
  }
  return { ok: true, reason: null };
}

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
// PAGED, because one request per document would trade one failure mode for a
// worse one. Voyage caps how many inputs a single request may carry, and an
// upload above that cap would fail ENTIRELY — every chunk unembedded — where
// the old chunk-by-chunk loop at least got most of them through. Paging keeps
// the batch win (one request per 96 chunks instead of 96) without introducing
// an all-or-nothing document.
//
// A LIMIT WE SET, NOT ONE WE INHERIT. The largest upload in the corpus is 48
// chunks so nothing hits this today; that is precisely why it is stated here
// rather than left to whatever the API happens to allow.
var VOYAGE_MAX_INPUTS = 96;

async function getVoyageEmbeddings(texts, label, opts) {
  var tag = label || 'kb';
  var attempts = (opts && typeof opts.attempts === 'number' && opts.attempts > 0)
    ? Math.min(opts.attempts, MAX_EMBED_ATTEMPTS) : MAX_EMBED_ATTEMPTS;
  if (!Array.isArray(texts) || texts.length === 0) return [];
  var out = new Array(texts.length).fill(null);

  if (!process.env.VOYAGE_API_KEY) {
    console.error('[' + tag + '] VOYAGE_API_KEY not configured — batch embedding skipped');
    return out;
  }
  for (var start = 0; start < texts.length; start += VOYAGE_MAX_INPUTS) {
    await embedPage(texts, out, start, Math.min(start + VOYAGE_MAX_INPUTS, texts.length), tag, attempts);
  }
  var missingTotal = out.filter(function (v) { return v === null; }).length;
  if (missingTotal > 0) {
    console.warn('[' + tag + '] Voyage returned ' + (out.length - missingTotal) + '/' + out.length + ' embeddings');
  }
  return out;
}

/* One page. Writes straight into `out` at its absolute offset.
   THE OFFSET IS THE WHOLE RISK HERE: Voyage's `index` is relative to the
   REQUEST, so a paged mapping must add `start` — without it page two would
   overwrite page one's vectors and every embedding after the first page would
   belong to the wrong chunk, silently. */
async function embedPage(texts, out, start, end, tag, maxAttempts) {
  var page = texts.slice(start, end);
  var limit = maxAttempts || MAX_EMBED_ATTEMPTS;

  for (var attempt = 1; attempt <= limit; attempt++) {
    try {
      var res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.VOYAGE_API_KEY,
        },
        body: JSON.stringify({ input: page, model: VOYAGE_MODEL }),
      });

      if (!res.ok) {
        var kind = classifyEmbedStatus(res.status);
        if (kind === 'temporary' && attempt < limit) {
          var wait = backoffMs(res, attempt);
          console.warn('[' + tag + '] Voyage HTTP ' + res.status + ' — retrying in ' + wait +
                       'ms (attempt ' + attempt + '/' + limit + ', ' + page.length + ' texts)');
          await sleep(wait);
          continue;
        }
        /* Abandoned. Loud, and it names WHY it will not be retried, so a
           permanent failure is never mistaken for a transient one that simply
           ran out of attempts. */
        console.error('[' + tag + '] Voyage batch embedding ABANDONED: HTTP ' + res.status +
                      ' (' + kind + ', ' + page.length + ' texts, ' + attempt + ' attempt(s)) — ' +
                      'these rows will be written unembedded and will be invisible to similarity search');
        return;
      }

      var data = await res.json();
      if (!data || !Array.isArray(data.data)) {
        console.error('[' + tag + '] Voyage batch embedding: unexpected response shape');
        return;
      }
      for (var i = 0; i < data.data.length; i++) {
        var item = data.data[i];
        if (!item || typeof item.index !== 'number') continue;
        if (item.index < 0 || item.index >= page.length) continue;  // never write past this page
        if (!Array.isArray(item.embedding)) continue;               // malformed -> stays null
        out[start + item.index] = item.embedding;                   // ABSOLUTE offset
      }
      return;

    } catch (err) {
      /* A network/timeout error is temporary by the same rule the model path
         uses: no status means a connection failure, not a rejection. */
      if (attempt < limit) {
        var w = Math.min(500 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        console.warn('[' + tag + '] Voyage network error — retrying in ' + w + 'ms (attempt ' +
                     attempt + '/' + limit + '): ' + err.message);
        await sleep(w);
        continue;
      }
      console.error('[' + tag + '] Voyage batch embedding ABANDONED after ' + attempt +
                    ' attempt(s): ' + err.message +
                    ' — these rows will be written unembedded');
      return;
    }
  }
}

module.exports = {
  getVoyageEmbedding: getVoyageEmbedding,
  getVoyageEmbeddings: getVoyageEmbeddings,
  embeddingCapability: embeddingCapability,
  classifyEmbedStatus: classifyEmbedStatus,
  MAX_EMBED_ATTEMPTS: MAX_EMBED_ATTEMPTS,
  VOYAGE_MAX_INPUTS: VOYAGE_MAX_INPUTS,
  VOYAGE_MODEL: VOYAGE_MODEL,
};
