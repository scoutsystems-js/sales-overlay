/**
 * SCOUT'S DOCTRINE (H732): eleven units, global scope, method not material; a constraint in the prompt, never
 * evidence; two hard rules enforced in code. The separation from team material is asserted on the executed
 * coaching path in test/coaching-kb-check.test.js.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../lib/doctrine');
const coaching = require('../lib/coaching');

const TITLES = ['What an objection is', 'The five objection types', 'The three-way boundary on money', 'Discovery is the upstream cause of every objection', 'Isolation is the correct first move', 'Tying back in', 'Follow-ups', 'Closing percentage counts prospects, not calls', 'How coaching is written', 'What good looks like', 'What Scout must never do'];

test('the approved text parses into exactly eleven complete units, one per entry, never split below an entry and never merged', () => {
  const units = D.readDoctrineFile();
  assert.deepStrictEqual(units.map((u) => u.title), TITLES);
  units.forEach((u) => { assert.ok(u.text.length > 150, u.title + ' is complete'); assert.ok(!/^## /m.test(u.text), 'no heading inside a unit'); });
  const rows = D.doctrineRows(units);
  assert.strictEqual(rows.length, 11);
  rows.forEach((r) => { assert.strictEqual(r.category, 'doctrine'); assert.strictEqual(r.scope, 'global'); assert.strictEqual(r.metadata.doctrine, true); assert.ok(r.metadata.key && r.metadata.version); assert.strictEqual(r.source_label, D.SOURCE_LABEL); });
  assert.strictEqual(new Set(rows.map((r) => r.metadata.key)).size, 11, 'keys unique');
});

test('each lane reads whole units by key — never fragments — and every key it asks for exists', () => {
  const doctrine = { units: D.readDoctrineFile(), hash: 'x' };
  Object.keys(D.LANE_KEYS).forEach((lane) => {
    const got = D.unitsFor(doctrine, lane);
    assert.strictEqual(got.length, D.LANE_KEYS[lane].length, lane + ': every key resolves to a unit');
    got.forEach((u) => assert.ok(u.text.length > 150));
    const block = D.doctrineBlock(doctrine, lane);
    assert.ok(/SCOUT'S METHOD/.test(block) && /never cite it/.test(block), lane + ': a constraint, never evidence');
    assert.ok(!/per the doctrine/i.test(block));
  });
  assert.strictEqual(D.doctrineBlock({ units: [], hash: 'none' }, 'coaching'), '', 'no units → no block');
});

test('⚠⚠ HARD RULE 1 in code: coaching that talks a rep out of isolating is dropped', () => {
  ['Instead of isolating, go straight to the close.', 'Rather than isolate the objection, answer it.', "Don't isolate here — it slows the call.", 'Skip the isolation step next time.', 'Isolating was a mistake at this point.'].forEach((t) => assert.ok(D.violatesIsolation(t), t));
  ['Isolate first, then address what they named.', 'You isolated well; the miss was after it.'].forEach((t) => assert.ok(!D.violatesIsolation(t), t));
  const kept = coaching.enforceHardRules([{ moment: 1, coaching: 'Instead of isolating, ask for the card.' }, { moment: 2, coaching: 'Isolate, then handle the fear you named.' }]);
  assert.deepStrictEqual(kept.map((e) => e.moment), [2]);
});

test('⚠⚠ HARD RULE 2 in code: a disqualification is never coached as a lost deal — the moment is never coached at all, and loss framing is dropped', () => {
  const rows = [
    { id: 'a', type: 'disqualify_signal', quote: 'I do not have the money for this', resolution: null },
    { id: 'b', type: 'objection', objection_class: 'disqualification', quote: 'I cannot afford it at all', resolution: 'unhandled' },
    { id: 'c', type: 'objection', objection_class: 'true_objection', quote: 'I need to think about it', resolution: 'unhandled' },
    { id: 'd', type: 'missed_opportunity', quote: 'She mentioned her sisters', resolution: null },
  ];
  assert.deepStrictEqual(coaching.selectCoachableMoments(rows).map((h) => h.id), ['c', 'd'], 'the DQ and the DQ-classed objection are never coached');
  assert.ok(D.framesDqAsLoss('You lost the deal when you let the price sit.') && D.framesDqAsLoss('A failed close: the money was never there.'));
  assert.ok(!D.framesDqAsLoss('This was a financial disqualification — the miss was in discovery, on qualification.'));
  assert.deepStrictEqual(coaching.enforceHardRules([{ moment: 1, coaching: 'You lost the deal here.' }, { moment: 2, coaching: 'Ask about savings before the pitch.' }]).map((e) => e.moment), [2]);
});

test('doctrine is method, not material: the retrieval carries it but never counts it; every lane prompt carries the block; no user-facing string names it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'kb-material.js'), 'utf8');
  assert.ok(/hasMaterial: hasContext \|\| hasNotes,/.test(src), 'hasMaterial ignores doctrine');
  assert.ok(/doctrine: doctrine,/.test(src) && /\|doctrine:' \+ doctrine\.hash/.test(src), 'doctrine rides the retrieval and its hash moves every key');
  ['lib/coaching.js', 'lib/team-synthesis.js', 'lib/performance-synthesis.js', 'lib/team-objection-summary.js', 'lib/team-digest.js', 'lib/objection-synthesis.js'].forEach((f) => assert.ok(/doctrineBlock/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), f + ' carries the block'));
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  assert.ok(!/per the doctrine/i.test(page), 'no user-facing string says "per the doctrine"');
  assert.ok(/doctrine: 'Scout\\'s method'/.test(page), 'the knowledge base page names it in the customer\'s words');
});
