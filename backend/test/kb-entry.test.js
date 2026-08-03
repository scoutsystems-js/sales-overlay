// lib/kb-entry.js — turning a call highlight into a knowledge_base entry.
// KB Part 2, sub-stage 2b (the manual "Add to Knowledge Base" button).
//
// Three concerns, all pure and all load-bearing:
//   • the DEDUPE KEY — (uploaded_by, fathom_call_id, section, hash(normalized quote)).
//     Deliberately NOT the highlight id: persistHighlights is insert-new-then-
//     delete-old, so re-analysis reissues fresh ids for the SAME moments and an
//     id-keyed index would silently readmit duplicates.
//   • the ENTRY SHAPE — category COLUMN 'learned_pattern' is what enforces ruling 1
//     (harvested material never reaches the grader).
//   • the WRITE TARGET — manager on a rep's call → team KB; anyone on own call → own KB.
const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeQuote, quoteHash, buildEntryContent, resolveEntryTarget, KB_ENTRY_METADATA_CATEGORY,
} = require('../lib/kb-entry');

// ── normalizeQuote / quoteHash ───────────────────────────────────────────
test('normalizeQuote collapses whitespace, case, and wrapping quotes', () => {
  assert.strictEqual(normalizeQuote('  "I need to talk   to my WIFE."  '), 'i need to talk to my wife');
  assert.strictEqual(normalizeQuote('I need to talk to my wife'), 'i need to talk to my wife');
  assert.strictEqual(normalizeQuote('“I need to talk to my wife”'), 'i need to talk to my wife');
});

test('normalizeQuote strips trailing punctuation but keeps internal punctuation', () => {
  // Internal punctuation can distinguish genuinely different moments, so it stays.
  assert.strictEqual(normalizeQuote("It's too expensive, honestly!"), "it's too expensive, honestly");
  assert.notStrictEqual(normalizeQuote('I can, sometimes'), normalizeQuote('I can sometimes'));
});

test('normalizeQuote is total on junk input', () => {
  for (const v of [null, undefined, '', '   ', 42, {}, []]) {
    assert.strictEqual(typeof normalizeQuote(v), 'string');
  }
});

test('quoteHash is stable, and differs for different quotes', () => {
  const a = quoteHash('  "Too   EXPENSIVE."  ');
  assert.strictEqual(a, quoteHash('too expensive'));
  assert.notStrictEqual(a, quoteHash('too cheap'));
  assert.match(a, /^[0-9a-f]{40}$/);
});

test('quoteHash of an empty/blank quote is null — never a shared bucket', () => {
  // A blank hash would make every quote-less moment collide with every other,
  // silently swallowing legitimate adds. Better to store null and skip dedupe.
  assert.strictEqual(quoteHash(''), null);
  assert.strictEqual(quoteHash('   '), null);
  assert.strictEqual(quoteHash(null), null);
});

// ── resolveEntryTarget — ruling 5 ────────────────────────────────────────
const manager = { role: 'manager', p_user_id: 'mgr-1', p_admin_id: 'mgr-1' };
const owner   = { role: 'owner',   p_user_id: 'own-1', p_admin_id: 'own-1' };
const rep     = { role: 'user',    p_user_id: 'rep-1', p_admin_id: 'mgr-1' };
const solo    = { role: 'user',    p_user_id: 'u-1',   p_admin_id: null };

test("a rep adding from their OWN call writes to their OWN KB (personal)", () => {
  const t = resolveEntryTarget(rep, 'rep-1');
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.target.scope, 'personal');
  assert.strictEqual(t.target.team_owner_id, null);
  assert.strictEqual(t.target.uploaded_by, 'rep-1');
});

test("a MANAGER adding from a REP's call writes to the TEAM KB (ruling 5)", () => {
  const t = resolveEntryTarget(manager, 'rep-1');
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.target.scope, 'team');
  assert.strictEqual(t.target.team_owner_id, 'mgr-1');
  // Provenance of the ACTION is the manager; the source call is recorded in metadata.
  assert.strictEqual(t.target.uploaded_by, 'mgr-1');
});

test('an OWNER-as-manager adding from a rep call also writes to team', () => {
  const t = resolveEntryTarget(owner, 'rep-7');
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.target.scope, 'team');
  assert.strictEqual(t.target.team_owner_id, 'own-1');
});

test("a manager adding from their OWN call writes personal, not team", () => {
  // Ruling 5: own call → own KB, regardless of role.
  const t = resolveEntryTarget(manager, 'mgr-1');
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.target.scope, 'personal');
});

test("a plain rep can NOT add from someone else's call", () => {
  const t = resolveEntryTarget(rep, 'rep-2');
  assert.strictEqual(t.ok, false);
});

test('a solo (teamless) user adding from their own call still works', () => {
  const t = resolveEntryTarget(solo, 'u-1');
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.target.scope, 'personal');
});

test('resolveEntryTarget is fail-closed on missing input', () => {
  assert.strictEqual(resolveEntryTarget(null, 'x').ok, false);
  assert.strictEqual(resolveEntryTarget(rep, null).ok, false);
});

// ── buildEntryContent + the ruling-1 enforcement ─────────────────────────
test('content includes the quote, the observation and the closer response', () => {
  const c = buildEntryContent({
    section: 'objection', type: 'objection', speaker: 'PROSPECT',
    quote: 'It costs too much', observation: 'Prospect balked at price',
    closer_response: 'What would it cost to stay where you are?', resolution: 'handled',
  });
  assert.ok(c.includes('It costs too much'));
  assert.ok(c.includes('Prospect balked at price'));
  assert.ok(c.includes('What would it cost to stay where you are?'));
  assert.ok(c.includes('objection'));
});

test('content omits the closer-response clause when there is none', () => {
  const c = buildEntryContent({ section: 'discovery', type: 'strong_moment', speaker: 'CLOSER', quote: 'q', observation: 'o' });
  assert.ok(!/responded/i.test(c));
  assert.ok(c.includes('q') && c.includes('o'));
});

test('buildEntryContent never throws on a sparse highlight', () => {
  for (const h of [{}, null, { quote: 'only a quote' }]) {
    assert.strictEqual(typeof buildEntryContent(h), 'string');
  }
});

test('RULING 1: metadata category is NOT a grader- or synthesis-visible category', () => {
  // The category COLUMN is 'learned_pattern' (set by the route). This asserts the
  // SECOND, independent filter: metadata.category must not appear in either list
  // in lib/selling-context.js, or harvested material would reach the grader.
  const { GRADER_CATEGORIES, SYNTHESIS_CATEGORIES } = require('../lib/selling-context');
  assert.ok(!GRADER_CATEGORIES.includes(KB_ENTRY_METADATA_CATEGORY));
  assert.ok(!SYNTHESIS_CATEGORIES.includes(KB_ENTRY_METADATA_CATEGORY));
});
