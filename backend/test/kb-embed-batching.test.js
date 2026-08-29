/**
 * EMBEDDINGS ARE BATCHED, NOT ONE REQUEST PER CHUNK (2026-08-29).
 *
 * /kb/upload fired a separate Voyage call for every chunk — a 48-chunk document
 * was 48 sequential round-trips, exposed to the same 429 that silently left the
 * harvest's late-call moments unembedded until IT was batched. /kb/store-patterns
 * carried the identical loop and is fixed at the same time: it is the same
 * defect, not a separate one.
 *
 * WHAT MUST NOT REGRESS is the degrade. getVoyageEmbeddings returns one slot per
 * input by contract, so a failed request leaves those chunks null and they are
 * still WRITTEN — findable by keyword, just not by similarity. An embedding
 * failure must never cost the upload.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const KB = fs.readFileSync(path.join(__dirname, '..', 'routes', 'kb.js'), 'utf8');

// comments first (line, then block) — this codebase archives removed code in
// place, so a raw match reports the prose ABOUT a loop as the loop
function code(s) {
  return s.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
          .replace(/\/\*[\s\S]*?\*\//g, '');
}
const CODE = code(KB);

test('no per-item embed loop survives in kb.js', () => {
  assert.ok(CODE.length > 5000, 'stripped source too small — the check is not measuring');
  // every remaining single-text call must be genuinely single: a search query
  // and one manual add. Neither is inside a for/while over a collection.
  const singles = CODE.split('\n')
    .map((l, i) => ({ l, i }))
    .filter(x => /await getVoyageEmbedding\(/.test(x.l));
  assert.strictEqual(singles.length, 2,
    'expected exactly two single-text embed calls (search query, manual add), found ' + singles.length);

  singles.forEach(x => {
    // look back 25 lines for a loop header enclosing this call
    const before = CODE.split('\n').slice(Math.max(0, x.i - 25), x.i).join('\n');
    assert.ok(!/\bfor\s*\(|\bwhile\s*\(/.test(before),
      'a single-text embed call sits inside a loop — batch it: ' + x.l.trim());
  });
});

test('both bulk paths use the batched call', () => {
  ['kb-upload', 'kb-patterns'].forEach(tag => {
    /* NOT [^)]* — the patterns call contains a map callback whose own ")"
       ends the class early, so the guard failed on correct code. */
    assert.ok(new RegExp("getVoyageEmbeddings\\([\\s\\S]{0,120}?'" + tag + "'").test(CODE),
      'the ' + tag + ' path must embed in one batched call');
  });
});

test('a failed embedding still writes the row — keyword-searchable, not lost', () => {
  // both bulk paths must tolerate a null slot rather than skipping the row
  assert.ok(/embeddings\[i\] \|\| null/.test(CODE), 'upload must degrade per-chunk to null');
  assert.ok(/patternEmb\[e\] \|\| null/.test(CODE), 'patterns must degrade per-item to null');
});

// ── the paging that stops one big upload becoming all-or-nothing ────────────
const VOYAGE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'voyage.js'), 'utf8');
const voyage = require('../lib/voyage');

test('the batch is PAGED, and the cap is ours rather than inherited', () => {
  assert.ok(typeof voyage.VOYAGE_MAX_INPUTS === 'number', 'the page size must be stated, not implicit');
  assert.ok(voyage.VOYAGE_MAX_INPUTS > 0 && voyage.VOYAGE_MAX_INPUTS <= 128,
    'page size must sit under the provider limit: ' + voyage.VOYAGE_MAX_INPUTS);
  assert.ok(/start \+ item\.index/.test(code(VOYAGE)),
    'a paged mapping MUST add the page offset, or page two overwrites page one');
});

test('paging maps every vector to its own input, even out of order', async () => {
  process.env.VOYAGE_API_KEY = 'test';
  const realFetch = global.fetch;
  let requests = 0;
  global.fetch = async (u, o) => {
    const body = JSON.parse(o.body);
    requests++;
    // deliberately reversed: mapping must use `index`, never array order
    const items = body.input.map((t, i) => ({ index: i, embedding: [Number(t)] })).reverse();
    return { ok: true, json: async () => ({ data: items }) };
  };
  try {
    const n = 250;
    const texts = Array.from({ length: n }, (_, i) => String(i));
    const out = await voyage.getVoyageEmbeddings(texts, 'probe');
    assert.strictEqual(out.length, n, 'contract: output length equals input length');
    assert.strictEqual(requests, Math.ceil(n / voyage.VOYAGE_MAX_INPUTS), 'wrong number of pages');
    const misplaced = out.map((v, i) => (v && v[0] === i) ? null : i).filter(v => v !== null);
    assert.deepStrictEqual(misplaced, [], 'a vector landed on the wrong input');
  } finally { global.fetch = realFetch; }
});

/* ⚠ CONVERTED 2026-08-29, NOT REWRITTEN TO PASS. This used to fail the page
   with a 429 — which no longer leaves it null, because a temporary status is
   now retried and recovers. The SUBJECT of the test outlives that scaffolding:
   one page failing must not lose the others, and the survivors must still sit
   at their ABSOLUTE offsets. So the vehicle changes to a PERMANENT status (400,
   which is deliberately not retried) and the assertions are untouched.
   The recovery behaviour itself is covered in test/voyage-retry.test.js. */
test('one PERMANENTLY failed page does not lose the others', async () => {
  process.env.VOYAGE_API_KEY = 'test';
  const realFetch = global.fetch;
  let call = 0;
  global.fetch = async (u, o) => {
    const body = JSON.parse(o.body);
    call++;
    if (call === 2) return { ok: false, status: 400, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, json: async () => ({ data: body.input.map((t, i) => ({ index: i, embedding: [Number(t)] })) }) };
  };
  try {
    const n = voyage.VOYAGE_MAX_INPUTS * 3;
    const out = await voyage.getVoyageEmbeddings(Array.from({ length: n }, (_, i) => String(i)), 'probe');
    assert.strictEqual(out.length, n, 'never returns a short array');
    const got = out.filter(Boolean).length;
    assert.strictEqual(got, n - voyage.VOYAGE_MAX_INPUTS, 'only the failed page should be null');
    // and the survivors are still on their own inputs
    out.forEach((v, i) => { if (v) assert.strictEqual(v[0], i, 'survivor misplaced at ' + i); });
  } finally { global.fetch = realFetch; }
});
