/**
 * LANES MUST NOT CONTRADICT EACH OTHER ON ONE PAGE (step 2, H728). Justin's correction governs:
 * generalising about "the team" is FINE. The defect is two lanes asserting opposites on one page because
 * each is generated blind. THE SHAPE: every generated lane on a page is handed the SAME deterministic
 * facts (section averages, objection handling by category), and a claim whose DIRECTION contradicts
 * them — a strength on the weakest section, a gap on the best-handled category — is dropped.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PF = require('../lib/page-facts');

const SECTIONS = { intro: 58, discovery: 62, pitch: 64, objection: 55, close: 49 };
const OBJ = { fear: { handled: 12, total: 40 }, timing: { handled: 3, total: 9 }, partner: { handled: 5, total: 177 }, logistical: { handled: 2, total: 4 }, uncategorized: { handled: 0, total: 1 } };

test('page facts: strongest and weakest section, best- and worst-handled category ABOVE the bucket floor', () => {
  const f = PF.pageFacts(SECTIONS, OBJ, { minBucket: 5 });
  assert.strictEqual(f.strongest, 'pitch'); assert.strictEqual(f.weakest, 'close');
  assert.strictEqual(f.worstCategory, 'partner', '5 of 177');
  assert.strictEqual(f.bestCategory, 'timing', '3 of 9 = 33% beats fear 30%; logistical and uncategorized are under the floor');
  assert.strictEqual(f.categories.partner.rate, 3);
  assert.ok(f.categories.logistical.below_floor === true);
});

test('the facts block names the numbers and the extremes in plain words, once', () => {
  const f = PF.pageFacts(SECTIONS, OBJ, { minBucket: 5 });
  const b = PF.factsBlock(f);
  assert.ok(/PAGE FACTS/.test(b) && /discovery 62/.test(b) && /partner 5\/177 \(3%\)/.test(b));
  assert.ok(/strongest section: pitch/.test(b) && /weakest section: close/.test(b));
  assert.ok(/best-handled: timing/.test(b) && /worst-handled: partner/.test(b));
  assert.ok(!/foreshadow|caused|because/.test(b));
});

test('⚠⚠ direction against the facts: a strength on the weakest section or the worst-handled category is dropped; a gap on the strongest or best-handled is dropped; the middle passes; no subject passes', () => {
  const f = PF.pageFacts(SECTIONS, OBJ, { minBucket: 5 });
  assert.ok(PF.claimContradictsFacts({ subject: { kind: 'section', section: 'close' } }, 'working', f), 'a strength on the weakest section');
  assert.ok(PF.claimContradictsFacts({ subject: { kind: 'section', section: 'pitch' } }, 'improve', f), 'a gap on the strongest section');
  assert.strictEqual(PF.claimContradictsFacts({ subject: { kind: 'section', section: 'discovery' } }, 'working', f), null, 'the middle is fine either way');
  assert.ok(PF.claimContradictsFacts({ subject: { kind: 'objection', category: 'partner' } }, 'working', f), '"reps are handling partner objections well" beside 5 of 177');
  assert.ok(PF.claimContradictsFacts({ subject: { kind: 'objection', category: 'timing' } }, 'improve', f), 'a gap on the best-handled');
  assert.strictEqual(PF.claimContradictsFacts({ subject: { kind: 'objection', category: 'logistical' } }, 'working', f), null, 'under the floor nothing is asserted');
  assert.strictEqual(PF.claimContradictsFacts({ subject: { kind: 'objection', category: null } }, 'working', f), null, 'objections in general: generalising is fine');
  assert.strictEqual(PF.claimContradictsFacts({ subject: { kind: 'count' } }, 'improve', f), null);
  assert.strictEqual(PF.claimContradictsFacts({}, 'working', f), null);
});

test('⚠ both lanes on a page are handed the SAME block and both check direction (pins + executed resolve)', () => {
  const ts = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
  const ps = fs.readFileSync(path.join(__dirname, '..', 'lib', 'performance-synthesis.js'), 'utf8');
  assert.ok(/require\('\.\/page-facts'\)/.test(ts) && /require\('\.\/page-facts'\)/.test(ps), 'both lanes read the one module');
  assert.ok(/factsBlock\(/.test(ts) && /factsBlock\(/.test(ps), 'both prompts carry the block');
  assert.ok(/claimContradictsFacts\(/.test(ts) && /claimContradictsFacts\(/.test(ps), 'both resolve steps check direction');
  assert.ok(/RECS_LANE_VERSION = 'v1[1-9]-/.test(ts) && /SYNTH_RULE_VERSION = 'v[6-9]-/.test(ps), 'both lanes moved their version (v11/v6 carried the facts; later bumps stand on them)');
  const lane = require('../lib/team-synthesis');
  const f = PF.pageFacts(SECTIONS, OBJ, { minBucket: 5 });
  const out = lane._resolveInsights([
    { claim: 'The team handles partner objections well.', data: 'x', evidence_id: null, subject: { kind: 'objection', category: 'partner' } },
    { claim: 'Discovery is solid.', data: 'y', evidence_id: null, subject: { kind: 'section', section: 'discovery' } },
  ], {}, [], { facts: f, direction: 'working' });
  assert.deepStrictEqual(out.map((i) => i.claim), ['Discovery is solid.'], 'the contradicting claim is dropped, the other stands');
});
