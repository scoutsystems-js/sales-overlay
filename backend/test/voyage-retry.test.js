/**
 * A TRANSIENT EMBEDDING FAILURE MUST NOT PERMANENTLY UNEMBED A ROW.
 *
 * ⚠⚠ THE DIAGNOSIS THAT PRODUCED THIS IS THE POINT, because the obvious story
 * was wrong. 386 harvested moments carried no embedding and the timing lined up
 * neatly with heavy grading runs — but the 84 most recent were the harvest
 * running in a LOCAL shell with NO KEY (total failure, boundary flipping four
 * minutes apart, which no rate limit does), and 170 more were seeded rows from
 * a script that has never contained any embedding code at all. Only the middle
 * population — 299 rows, PARTIAL failure at 26-32% under concurrent load — is
 * the kind a retry can help.
 *
 * ⚠ So this file guards THREE different things, deliberately: that a temporary
 * failure is retried, that a permanent one is NOT, and that a missing key is
 * reported as a CAPABILITY problem rather than retried forever.
 */
const test = require('node:test');
const assert = require('node:assert');

const V = require('../lib/voyage');

const KEY = 'VOYAGE_API_KEY';
function withKey(v, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, KEY);
  const old = process.env[KEY];
  if (v === null) delete process.env[KEY]; else process.env[KEY] = v;
  return Promise.resolve().then(fn).finally(() => {
    if (had) process.env[KEY] = old; else delete process.env[KEY];
  });
}

/** A fetch stub returning a scripted sequence of responses. */
function stubFetch(sequence) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const step = sequence[Math.min(calls.length, sequence.length - 1)];
    calls.push(JSON.parse(opts.body).input.length);
    if (step.throw) throw new Error(step.throw);
    return {
      ok: step.status === 200,
      status: step.status,
      headers: { get: n => (n === 'retry-after' ? step.retryAfter || null : null) },
      json: async () => step.body || { data: [] },
    };
  };
  return calls;
}
function okBody(n) {
  return { data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [i, 0.5] })) };
}

const REAL_FETCH = global.fetch;
test.afterEach(() => { global.fetch = REAL_FETCH; });

test('a 429 is retried and the page RECOVERS', async () => {
  await withKey('k', async () => {
    const calls = stubFetch([
      { status: 429, retryAfter: '0' },
      { status: 200, body: okBody(3) },
    ]);
    const out = await V.getVoyageEmbeddings(['a', 'b', 'c'], 't');
    assert.strictEqual(calls.length, 2, 'it must have retried exactly once');
    assert.strictEqual(out.filter(Boolean).length, 3, 'the retry must recover every vector');
  });
});

test('⚠ a PERMANENT status is NOT retried — one attempt only', async () => {
  /* 400/401/403 will not improve on their own. Retrying them burns the request
     path and delays the caller for a guaranteed failure. */
  await withKey('k', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const calls = stubFetch([{ status }]);
      const out = await V.getVoyageEmbeddings(['a', 'b'], 't');
      assert.strictEqual(calls.length, 1, 'HTTP ' + status + ' must not be retried');
      assert.deepStrictEqual(out, [null, null]);
    }
  });
});

test('a temporary failure that never clears is ABANDONED, bounded, without throwing', async () => {
  await withKey('k', async () => {
    const calls = stubFetch([{ status: 429, retryAfter: '0' }]);
    const out = await V.getVoyageEmbeddings(['a', 'b'], 't');
    assert.strictEqual(calls.length, V.MAX_EMBED_ATTEMPTS, 'bounded at MAX_EMBED_ATTEMPTS');
    assert.deepStrictEqual(out, [null, null], 'the degrade stays correct — nulls, never a throw');
  });
});

test('a network error is retried too, then abandoned', async () => {
  await withKey('k', async () => {
    const calls = stubFetch([{ throw: 'ECONNRESET' }]);
    const out = await V.getVoyageEmbeddings(['a'], 't');
    assert.strictEqual(calls.length, V.MAX_EMBED_ATTEMPTS);
    assert.deepStrictEqual(out, [null]);
  });
});

test('⚠ THE CONTRACT SURVIVES THE RETRY: output length always equals input', async () => {
  await withKey('k', async () => {
    stubFetch([{ status: 429, retryAfter: '0' }]);
    for (const n of [1, 5, 40]) {
      const out = await V.getVoyageEmbeddings(Array.from({ length: n }, (_, i) => 'x' + i), 't');
      assert.strictEqual(out.length, n, 'never a short array, even when every page fails');
    }
  });
});

test('one failing PAGE does not lose the others, and the offset still holds', async () => {
  await withKey('k', async () => {
    /* Page 1 fails permanently, page 2 succeeds. Page 2's vectors must land at
       their ABSOLUTE positions — the paging risk the batch work exists for. */
    let n = 0;
    global.fetch = async (url, opts) => {
      const size = JSON.parse(opts.body).input.length;
      n++;
      if (n === 1) return { ok: false, status: 400, headers: { get: () => null }, json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => okBody(size) };
    };
    const texts = Array.from({ length: V.VOYAGE_MAX_INPUTS + 3 }, (_, i) => 'x' + i);
    const out = await V.getVoyageEmbeddings(texts, 't');
    assert.strictEqual(out.length, texts.length);
    for (let i = 0; i < V.VOYAGE_MAX_INPUTS; i++) assert.strictEqual(out[i], null, 'page 1 stays null');
    for (let i = V.VOYAGE_MAX_INPUTS; i < texts.length; i++) {
      assert.ok(Array.isArray(out[i]), 'page 2 must land at its absolute offset, slot ' + i);
    }
  });
});

/* ── the capability check: the one that would have prevented the 84 ───────── */

test('⚠⚠ a MISSING KEY is a capability failure, not something to retry', async () => {
  await withKey(null, async () => {
    const cap = V.embeddingCapability();
    assert.strictEqual(cap.ok, false);
    assert.match(cap.reason, /VOYAGE_API_KEY/, 'it must name what is missing');

    const calls = stubFetch([{ status: 200, body: okBody(2) }]);
    const out = await V.getVoyageEmbeddings(['a', 'b'], 't');
    assert.strictEqual(calls.length, 0, 'it must not call the provider at all without a key');
    assert.deepStrictEqual(out, [null, null], 'and the rows are still writable');
  });
});

test('with a key present the capability is ok', async () => {
  await withKey('k', () => {
    assert.deepStrictEqual(V.embeddingCapability(), { ok: true, reason: null });
  });
});

test('the permanent-status list is REUSED from model-retry, never re-declared', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'voyage.js'), 'utf8');
  const code = src.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
                  .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/PERMANENT_STATUSES \} = require\('\.\/model-retry'\)/.test(code),
    'voyage must import the shared list');
  assert.ok(!/PERMANENT_STATUSES = \[/.test(code), 'and must not declare its own copy');
  // the classification must agree with the module it borrowed from
  const { PERMANENT_STATUSES } = require('../lib/model-retry');
  PERMANENT_STATUSES.forEach(s => assert.strictEqual(V.classifyEmbedStatus(s), 'permanent'));
  [429, 500, 502, 503, 529].forEach(s => assert.strictEqual(V.classifyEmbedStatus(s), 'temporary'));
});
