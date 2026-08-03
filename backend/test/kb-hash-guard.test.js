// RULING 1 GUARD (KB Part 2, sub-stage 2c).
//
// Harvested call moments must not reach the grader, and must not perturb kbHash.
// kbHash is computed from the chunks fetchSellingContext actually INCLUDES, and
// it invalidates the synthesis caches (objection_synthesis_cache). If harvested
// rows ever entered that set, EVERY closed call would shift the hash and force a
// cache regeneration — a recurring Claude bill triggered by a write path that is
// supposed to be free.
//
// Today that cost is avoided. But it is avoided as a SIDE EFFECT of the category
// choices in lib/kb-entry.js, and side effects don't survive future edits. This
// file makes the guarantee explicit and failure loud.
//
// Two layers:
//   (1) STRUCTURAL — the metadata category is absent from both category lists.
//   (2) BEHAVIOURAL — drive the REAL fetchSellingContext against a fake Supabase
//       holding a harvested row alongside a genuine offer doc, and assert the
//       harvested row lands in neither contextText nor kbHash. This catches a
//       regression that a list check alone would miss (e.g. someone widening the
//       `category = 'user_upload'` filter).
const test = require('node:test');
const assert = require('node:assert');
const {
  fetchSellingContext, GRADER_CATEGORIES, SYNTHESIS_CATEGORIES,
} = require('../lib/selling-context');
const { buildMomentRow, KB_ENTRY_METADATA_CATEGORY } = require('../lib/kb-entry');

// ── (1) structural ───────────────────────────────────────────────────────
test('RULING 1: the harvested metadata category is in NEITHER category list', () => {
  assert.ok(
    !GRADER_CATEGORIES.includes(KB_ENTRY_METADATA_CATEGORY),
    'RULING 1 VIOLATED: "' + KB_ENTRY_METADATA_CATEGORY + '" was added to GRADER_CATEGORIES. ' +
    'Harvested call moments would now be injected into SELLING CONTEXT, whose prompt says ' +
    '"do not penalize approaches this material explicitly endorses" — making the team\'s own ' +
    'past calls the standard they are graded against. Re-open ruling 1 before changing this.'
  );
  assert.ok(
    !SYNTHESIS_CATEGORIES.includes(KB_ENTRY_METADATA_CATEGORY),
    'RULING 1 VIOLATED: "' + KB_ENTRY_METADATA_CATEGORY + '" was added to SYNTHESIS_CATEGORIES. ' +
    'Harvested moments would feed the synthesis prompts AND start moving kbHash, invalidating ' +
    'the synthesis caches on every closed call.'
  );
});

test('the harvested row shape uses a category COLUMN that fetchSellingContext filters out', () => {
  const row = buildMomentRow({
    highlight: { section: 'close', type: 'strong_moment', quote: 'q', observation: 'o' },
    target: { scope: 'personal', team_owner_id: null, uploaded_by: 'u-1' },
    fathomCallId: 'c-1', source: 'auto_closed_call',
  });
  assert.notStrictEqual(row.category, 'user_upload',
    'RULING 1 VIOLATED: harvested rows now carry category=user_upload, which is the exact ' +
    'filter fetchSellingContext selects on. They would enter the grader context.');
  assert.strictEqual(row.category, 'learned_pattern');
});

// ── (2) behavioural ──────────────────────────────────────────────────────
// Minimal Supabase stand-in that APPLIES the filters fetchSellingContext builds,
// so the test exercises the real selection logic rather than trusting it.
function fakeAdmin(kbRows, profile) {
  return {
    from(table) {
      const state = { table, filters: [] };
      const api = {
        select() { return api; },
        eq(col, val) { state.filters.push(['eq', col, val]); return api; },
        in(col, vals) { state.filters.push(['in', col, vals]); return api; },
        maybeSingle() { return Promise.resolve({ data: profile, error: null }); },
        then(resolve) {
          const rows = kbRows.filter((r) => state.filters.every(([op, col, val]) => {
            const actual = col === 'metadata->>category' ? (r.metadata && r.metadata.category) : r[col];
            return op === 'in' ? val.includes(actual) : actual === val;
          }));
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return api;
    },
  };
}

const OFFER = {
  id: 'kb-offer', label: 'Offer doc', scope: 'personal', uploaded_by: 'u-1',
  // The category COLUMN is 'user_upload' for real uploads; the content type lives
  // in metadata.category. Omitting the column made every query return empty and
  // both sides of the hash comparison 'none' — a vacuous pass. Hence the
  // non-'none' assertions below.
  category: 'user_upload',
  content: 'OFFER_DOC_MARKER our program costs 8k and includes weekly coaching',
  metadata: { category: 'offer_document', chunk_index: 0 }, created_at: '2026-01-01',
};

// A harvested moment as buildMomentRow actually produces it, given a DB id.
function harvestedRow() {
  const r = buildMomentRow({
    highlight: { section: 'close', type: 'strong_moment', quote: 'HARVEST_MARKER I just need you to say yes', observation: 'clean assumptive close' },
    target: { scope: 'personal', team_owner_id: null, uploaded_by: 'u-1' },
    fathomCallId: 'c-1', source: 'auto_closed_call',
  });
  r.id = 'kb-harvest';
  r.created_at = '2026-02-01';
  return r;
}

test('BEHAVIOURAL: a harvested moment never enters the grader context', async () => {
  const withHarvest = await fetchSellingContext(fakeAdmin([OFFER, harvestedRow()], { managed_by: null }), 'u-1');
  assert.ok(withHarvest.contextText.includes('OFFER_DOC_MARKER'), 'the genuine offer doc should be included');
  assert.ok(
    !withHarvest.contextText.includes('HARVEST_MARKER'),
    'RULING 1 VIOLATED: a harvested call moment reached the grader SELLING CONTEXT.'
  );
});

test('BEHAVIOURAL: kbHash is IDENTICAL with and without harvested rows present', async () => {
  // The cost guarantee. If this ever fails, every closed call starts invalidating
  // the synthesis caches and regenerating them at Claude prices.
  const without = await fetchSellingContext(fakeAdmin([OFFER], { managed_by: null }), 'u-1');
  const withOne = await fetchSellingContext(fakeAdmin([OFFER, harvestedRow()], { managed_by: null }), 'u-1');

  assert.notStrictEqual(without.kbHash, 'none', 'fixture should produce a real hash');
  assert.strictEqual(
    withOne.kbHash, without.kbHash,
    'RULING 1 COST GUARANTEE VIOLATED: harvested moments now move kbHash. Every closed call ' +
    'would invalidate this user\'s cached syntheses and force a paid regeneration.'
  );
});

test('BEHAVIOURAL: many harvested rows still do not move kbHash', async () => {
  // A busy closer could accumulate dozens. Scale must not change the answer.
  const many = [OFFER];
  for (let i = 0; i < 25; i++) {
    const r = harvestedRow();
    r.id = 'kb-harvest-' + i;
    many.push(r);
  }
  const base = await fetchSellingContext(fakeAdmin([OFFER], { managed_by: null }), 'u-1');
  const loaded = await fetchSellingContext(fakeAdmin(many, { managed_by: null }), 'u-1');
  // Non-vacuity: if the fixture produced no context at all, both sides would be
  // 'none' and this test would pass while proving nothing.
  assert.notStrictEqual(base.kbHash, 'none', 'fixture must produce a real hash');
  assert.ok(base.contextText.includes('OFFER_DOC_MARKER'));
  assert.strictEqual(loaded.kbHash, base.kbHash);
  assert.ok(!loaded.contextText.includes('HARVEST_MARKER'));
});
