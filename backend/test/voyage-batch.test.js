// lib/voyage.js getVoyageEmbeddings — ONE Voyage request for a whole call's
// harvested moments, replacing N sequential singles.
//
// Why batching rather than a delay (2026-08-03 defect): the in-situ 2d run fired
// 5 sequential embeds, got 3 back and then HTTP 429 on #4 and #5. A delay would
// only slow the pass and still rate-limit at scale, and — crucially — it would
// not remove the SYSTEMATIC BIAS. selectHarvestMoments preserves chronological
// order, so the dropouts are always the late-call sections, `close` above all:
// exactly the moments a "how do I close" semantic search must find.
//
// The contract that matters most here is ALIGNMENT and PARTIAL FAILURE. A batch
// error must never lose the harvest — every input must map to a vector or an
// explicit null, in position, so the caller can still write every row.
const test = require('node:test');
const assert = require('node:assert');
const { getVoyageEmbeddings } = require('../lib/voyage');

const realFetch = global.fetch;
function stubFetch(handler) { global.fetch = handler; }
function restore() { global.fetch = realFetch; }

const KEY = 'VOYAGE_API_KEY';
function withKey(fn) {
  return async () => {
    const prev = process.env[KEY];
    process.env[KEY] = 'test-key';
    try { await fn(); } finally {
      if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev;
      restore();
    }
  };
}

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

test('sends ONE request containing every text (not N requests)', withKey(async () => {
  let calls = 0; let sentInput = null;
  stubFetch((url, opts) => {
    calls++;
    sentInput = JSON.parse(opts.body).input;
    return ok({ data: sentInput.map((_, i) => ({ index: i, embedding: [i, i, i] })) });
  });
  const out = await getVoyageEmbeddings(['a', 'b', 'c', 'd', 'e']);
  assert.strictEqual(calls, 1, 'must be a single batched request');
  assert.deepStrictEqual(sentInput, ['a', 'b', 'c', 'd', 'e']);
  assert.deepStrictEqual(out, [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]]);
}));

test('maps by the response index, not by array position', withKey(async () => {
  // Voyage documents an `index` field. Trusting array order would silently
  // attach the wrong vector to the wrong moment if the API ever reorders —
  // a corruption that would be invisible until search results made no sense.
  stubFetch(() => ok({ data: [
    { index: 2, embedding: ['third'] },
    { index: 0, embedding: ['first'] },
    { index: 1, embedding: ['second'] },
  ] }));
  const out = await getVoyageEmbeddings(['a', 'b', 'c']);
  assert.deepStrictEqual(out, [['first'], ['second'], ['third']]);
}));

// ── PARTIAL FAILURE — a batch error must never lose the harvest ──────────
test('PARTIAL: missing indices become null, present ones survive in place', withKey(async () => {
  stubFetch(() => ok({ data: [
    { index: 0, embedding: ['e0'] },
    { index: 3, embedding: ['e3'] },
  ] }));
  const out = await getVoyageEmbeddings(['a', 'b', 'c', 'd']);
  assert.strictEqual(out.length, 4, 'length must always match the input');
  assert.deepStrictEqual(out, [['e0'], null, null, ['e3']]);
}));

test('PARTIAL: a malformed entry becomes null without killing its neighbours', withKey(async () => {
  stubFetch(() => ok({ data: [
    { index: 0, embedding: ['good'] },
    { index: 1, embedding: null },
    { index: 2 },
    { index: 3, embedding: 'not-an-array' },
    { index: 4, embedding: ['also-good'] },
  ] }));
  const out = await getVoyageEmbeddings(['a', 'b', 'c', 'd', 'e']);
  assert.deepStrictEqual(out, [['good'], null, null, null, ['also-good']]);
}));

test('PARTIAL: an out-of-range index is ignored, not written past the end', withKey(async () => {
  stubFetch(() => ok({ data: [
    { index: 0, embedding: ['e0'] },
    { index: 99, embedding: ['nope'] },
    { index: -1, embedding: ['nope'] },
  ] }));
  const out = await getVoyageEmbeddings(['a', 'b']);
  assert.deepStrictEqual(out, [['e0'], null]);
}));

// ── TOTAL failure — still never loses the harvest ────────────────────────
test('HTTP 429 returns all-nulls of the right length (rows still writable)', withKey(async () => {
  stubFetch(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }));
  const out = await getVoyageEmbeddings(['a', 'b', 'c']);
  assert.deepStrictEqual(out, [null, null, null]);
}));

test('a network throw returns all-nulls, never rejects', withKey(async () => {
  stubFetch(() => Promise.reject(new Error('ECONNRESET')));
  const out = await getVoyageEmbeddings(['a', 'b']);
  assert.deepStrictEqual(out, [null, null]);
}));

test('a malformed response body returns all-nulls', withKey(async () => {
  stubFetch(() => ok({ nope: true }));
  const out = await getVoyageEmbeddings(['a', 'b']);
  assert.deepStrictEqual(out, [null, null]);
}));

test('missing VOYAGE_API_KEY returns all-nulls without calling out', async () => {
  const prev = process.env[KEY];
  delete process.env[KEY];
  let called = false;
  stubFetch(() => { called = true; return ok({ data: [] }); });
  try {
    const out = await getVoyageEmbeddings(['a', 'b']);
    assert.deepStrictEqual(out, [null, null]);
    assert.strictEqual(called, false);
  } finally {
    if (prev !== undefined) process.env[KEY] = prev;
    restore();
  }
});

// ── Degenerate input ─────────────────────────────────────────────────────
test('empty / junk input never calls Voyage and returns an empty array', withKey(async () => {
  let called = false;
  stubFetch(() => { called = true; return ok({ data: [] }); });
  for (const v of [[], null, undefined, 'nope', 42]) {
    assert.deepStrictEqual(await getVoyageEmbeddings(v), []);
  }
  assert.strictEqual(called, false);
}));

test('a single text still works through the batch path', withKey(async () => {
  stubFetch(() => ok({ data: [{ index: 0, embedding: ['only'] }] }));
  assert.deepStrictEqual(await getVoyageEmbeddings(['just one']), [['only']]);
}));
