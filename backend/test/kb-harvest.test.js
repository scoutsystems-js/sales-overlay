// lib/kb-harvest.js — auto-population of a closed call's winning moments into
// the REP'S OWN knowledge base. KB Part 2, sub-stage 2d.
//
// Three things must hold, and each has burned a prior stage if got wrong:
//   • the GATE  — outcome 'closed' alone (ruling 4). NOT cash_collected > 0:
//     a payment-plan close with nothing due at signing legitimately records 0.
//   • the CAP   — ~2 per section per call (ruling 3), because on real closed
//     calls `close` outnumbers `objection` roughly 9:1 and would swamp it.
//   • IDEMPOTENCY — the dedupe key is shared with the manual button, so
//     harvesting a moment a rep already added by hand must be a no-op.
const test = require('node:test');
const assert = require('node:assert');
const { selectHarvestMoments, shouldHarvest, HARVEST_SECTION_CAP } = require('../lib/kb-harvest');

function hl(section, type, quote, extra) {
  return Object.assign({ id: 'h-' + quote, section: section, type: type, quote: quote, speaker: 'CLOSER', observation: 'o' }, extra || {});
}

// ── The gate (ruling 4) ──────────────────────────────────────────────────
test('harvest fires on a closed call', () => {
  assert.strictEqual(shouldHarvest('closed'), true);
});

test('harvest does NOT fire on follow_up, lost, no_show, or null', () => {
  for (const o of ['follow_up', 'lost', 'no_show', null, undefined, '', 'CLOSED ']) {
    assert.strictEqual(shouldHarvest(o), false, 'should not harvest: ' + JSON.stringify(o));
  }
});

test('RULING 4: the gate does not consider cash — a zero-cash close still harvests', () => {
  // A payment-plan close collects nothing at signing. Gating on cash would drop
  // exactly the wins a coaching KB most wants. shouldHarvest takes ONLY outcome,
  // so cash cannot leak into the decision by a later edit.
  assert.strictEqual(shouldHarvest.length, 1);
  assert.strictEqual(shouldHarvest('closed'), true);
});

// ── The filter ───────────────────────────────────────────────────────────
test('only GOOD-group moments are harvested', () => {
  const picked = selectHarvestMoments([
    hl('discovery', 'strong_moment', 'a'),
    hl('discovery', 'missed_opportunity', 'b'),   // bad group
    hl('discovery', 'disqualify_signal', 'c'),    // bad group
  ]);
  assert.deepStrictEqual(picked.map((m) => m.quote), ['a']);
});

test('a HANDLED objection is good; partial/unhandled are not', () => {
  const picked = selectHarvestMoments([
    hl('objection', 'objection', 'handled-one', { resolution: 'handled' }),
    hl('objection', 'objection', 'partial-one', { resolution: 'partial' }),
    hl('objection', 'objection', 'unhandled-one', { resolution: 'unhandled' }),
  ]);
  assert.deepStrictEqual(picked.map((m) => m.quote), ['handled-one']);
});

test('UNTAGGED moments (no section) are skipped — nothing to file them under', () => {
  const picked = selectHarvestMoments([
    hl(null, 'strong_moment', 'no-section'),
    hl('pitch', 'strong_moment', 'tagged'),
  ]);
  assert.deepStrictEqual(picked.map((m) => m.quote), ['tagged']);
});

test('a moment with a blank quote is skipped (it would carry a null dedupe key)', () => {
  const picked = selectHarvestMoments([
    hl('pitch', 'strong_moment', '   '),
    hl('pitch', 'strong_moment', 'real'),
  ]);
  assert.deepStrictEqual(picked.map((m) => m.quote), ['real']);
});

// ── The cap (ruling 3) ───────────────────────────────────────────────────
test('caps at ~2 per SECTION, not 2 per call', () => {
  const picked = selectHarvestMoments([
    hl('close', 'strong_moment', 'c1'), hl('close', 'strong_moment', 'c2'), hl('close', 'strong_moment', 'c3'),
    hl('discovery', 'strong_moment', 'd1'), hl('discovery', 'strong_moment', 'd2'), hl('discovery', 'strong_moment', 'd3'),
  ]);
  assert.strictEqual(picked.length, 2 * HARVEST_SECTION_CAP);
  assert.deepStrictEqual(picked.filter((m) => m.section === 'close').map((m) => m.quote), ['c1', 'c2']);
  assert.deepStrictEqual(picked.filter((m) => m.section === 'discovery').map((m) => m.quote), ['d1', 'd2']);
});

test('RULING 3: a close-heavy call can no longer swamp discovery and objection', () => {
  // Shaped like the real data: on tagged closed calls `close` carries 62 good
  // moments to objection's 6. Uncapped, close would be ~63% of every harvest.
  const many = [];
  for (let i = 0; i < 20; i++) many.push(hl('close', 'strong_moment', 'close-' + i));
  many.push(hl('objection', 'objection', 'obj-1', { resolution: 'handled' }));
  many.push(hl('discovery', 'strong_moment', 'disc-1'));

  const picked = selectHarvestMoments(many);
  assert.strictEqual(picked.filter((m) => m.section === 'close').length, HARVEST_SECTION_CAP);
  assert.strictEqual(picked.filter((m) => m.section === 'objection').length, 1);
  assert.strictEqual(picked.filter((m) => m.section === 'discovery').length, 1);
  // close is now a minority of the harvest, not 90% of it.
  assert.ok(picked.filter((m) => m.section === 'close').length <= picked.length / 2);
});

test('close is CAPPED, never EXCLUDED (ruling 3)', () => {
  const picked = selectHarvestMoments([hl('close', 'strong_moment', 'c1')]);
  assert.deepStrictEqual(picked.map((m) => m.quote), ['c1']);
});

test('selection is deterministic and order-stable across runs', () => {
  const input = [
    hl('close', 'strong_moment', 'c1'), hl('discovery', 'strong_moment', 'd1'),
    hl('close', 'strong_moment', 'c2'), hl('close', 'strong_moment', 'c3'),
  ];
  assert.deepStrictEqual(selectHarvestMoments(input), selectHarvestMoments(input.slice()));
});

test('selectHarvestMoments is total on junk input', () => {
  for (const v of [null, undefined, [], [null], [{}], 'nope']) {
    assert.ok(Array.isArray(selectHarvestMoments(v)));
  }
});

// ── Idempotency with the manual button ───────────────────────────────────
test('IDEMPOTENT: a harvested moment produces the SAME dedupe key as a manual add', () => {
  // This is the whole guarantee. Both paths build the row through
  // buildMomentRow with uploaded_by = the rep, so the unique index sees an
  // identical key and the second write is a no-op regardless of which ran first.
  const { buildMomentRow } = require('../lib/kb-entry');
  const moment = hl('objection', 'objection', 'It costs too much', { resolution: 'handled' });
  const target = { scope: 'personal', team_owner_id: null, uploaded_by: 'rep-1' };

  const auto = buildMomentRow({ highlight: moment, target: target, fathomCallId: 'call-1', source: 'auto_closed_call', sourceUserId: 'rep-1' });
  const manual = buildMomentRow({ highlight: moment, target: target, fathomCallId: 'call-1', source: 'manual_add', sourceUserId: 'rep-1', addedBy: 'rep-1' });

  const key = (r) => [r.uploaded_by, r.source_fathom_call_id, r.source_section, r.source_quote_hash].join('|');
  assert.strictEqual(key(auto), key(manual));
  // ...while still recording HOW each got there.
  assert.strictEqual(auto.metadata.source, 'auto_closed_call');
  assert.strictEqual(manual.metadata.source, 'manual_add');
});

test('quote re-wording changes the key (known limit, pinned so it stays known)', () => {
  const { buildMomentRow } = require('../lib/kb-entry');
  const target = { scope: 'personal', team_owner_id: null, uploaded_by: 'rep-1' };
  const a = buildMomentRow({ highlight: hl('pitch', 'strong_moment', 'It costs too much'), target, fathomCallId: 'c', source: 'auto_closed_call' });
  const b = buildMomentRow({ highlight: hl('pitch', 'strong_moment', 'It just costs too much'), target, fathomCallId: 'c', source: 'auto_closed_call' });
  assert.notStrictEqual(a.source_quote_hash, b.source_quote_hash);
  // ...but pure formatting drift does NOT.
  const c = buildMomentRow({ highlight: hl('pitch', 'strong_moment', '  "IT COSTS TOO MUCH."  '), target, fathomCallId: 'c', source: 'auto_closed_call' });
  assert.strictEqual(a.source_quote_hash, c.source_quote_hash);
});

test('auto-population writes to the REP’s OWN KB (personal, no team key)', () => {
  const { buildMomentRow } = require('../lib/kb-entry');
  const row = buildMomentRow({
    highlight: hl('discovery', 'strong_moment', 'q'),
    target: { scope: 'personal', team_owner_id: null, uploaded_by: 'rep-9' },
    fathomCallId: 'c', source: 'auto_closed_call', sourceUserId: 'rep-9',
  });
  assert.strictEqual(row.scope, 'personal');
  assert.strictEqual(row.team_owner_id, null);
  assert.strictEqual(row.uploaded_by, 'rep-9');
});

test('RULING 1 holds automatically for harvested rows (same shape as 2b)', () => {
  const { buildMomentRow, KB_ENTRY_METADATA_CATEGORY } = require('../lib/kb-entry');
  const { GRADER_CATEGORIES, SYNTHESIS_CATEGORIES } = require('../lib/selling-context');
  const row = buildMomentRow({
    highlight: hl('close', 'strong_moment', 'q'),
    target: { scope: 'personal', team_owner_id: null, uploaded_by: 'r' },
    fathomCallId: 'c', source: 'auto_closed_call',
  });
  assert.strictEqual(row.category, 'learned_pattern');          // filter (a)
  assert.strictEqual(row.metadata.category, KB_ENTRY_METADATA_CATEGORY);
  assert.ok(!GRADER_CATEGORIES.includes(row.metadata.category));  // filter (b)
  assert.ok(!SYNTHESIS_CATEGORIES.includes(row.metadata.category));
});
