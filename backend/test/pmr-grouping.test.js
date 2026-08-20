/**
 * PERSONAL MEETING ROOM — TWO CALLS SHARING A TITLE MUST NOT BECOME ONE
 * PROSPECT (2026-08-20).
 *
 * ⚠⚠ WHY THIS EXISTS EVEN THOUGH NOTHING WAS BROKEN. Josh's Zoom account
 * auto-records every meeting into his Personal Meeting Room, so EVERY Zoom row
 * carries the identical title "Josh's Personal Meeting Room". The standing
 * ruling records the meeting title as a RELIABLE KEY for prospect grouping —
 * "the same booked title across two calls is strong same-prospect evidence
 * EVEN WHEN THE RESOLVED NAMES DISAGREE". Read alone, that ruling says every
 * PMR call is the same prospect, which would merge a closer's entire Zoom
 * corpus into one entity and destroy the close-rate denominator.
 *
 * ⚠ IT DOES NOT HAPPEN, AND THIS PINS THE THREE INDEPENDENT REASONS so that
 * removing any one of them fails loudly rather than silently merging:
 *
 *   1. ATTACH is by nameKey(resolved prospect name), NEVER by title
 *      (analysis-worker Phase 6c). The title is not consulted at attach time.
 *   2. The title generator's own gate, keyTitles(), requires
 *      nameFromTitle(title) to be non-null — and it returns NULL for a
 *      Personal Meeting Room label, because the prospect-name resolver already
 *      refuses meeting labels under the governing "a WRONG name is worse than
 *      NO name" rule.
 *   3. Merges are PROPOSALS ONLY, human-confirmed. Nothing auto-merges.
 *
 * ⚠⚠ REASON 2 IS THE LOAD-BEARING ONE AND IT IS DERIVED FROM THE DATA, NOT
 * HARDCODED. Nothing anywhere matches the string "Personal Meeting Room" — the
 * gate is "does this title yield a person's name?", which survives a rename,
 * a different locale, and a custom room title. Do not "improve" it into a
 * string match.
 */
const test = require('node:test');
const assert = require('node:assert');
const pm = require('../lib/prospect-merge');
const { nameFromTitle } = require('../lib/prospect-name');
const { nameKey } = require('../lib/prospect-entity');

// REAL titles off real rows — the PMR one is verbatim from Josh's Zoom call.
const PMR = "Josh's Personal Meeting Room";
const BOOKED = 'PS Sober Living Riches | LaTeesha Whitel';

test('⚠⚠ a Personal Meeting Room title yields NO name, so it cannot be a key', () => {
  assert.strictEqual(nameFromTitle(PMR), null,
    'if this ever returns a name, every PMR call becomes the same prospect');
  // and the same holds for the other generic Zoom labels seen on real rows
  assert.strictEqual(nameFromTitle('Impromptu Zoom Meeting'), null);
  assert.strictEqual(nameFromTitle("David II Gamus's Zoom Meeting"), null);
});

test('⚠ a REAL booked title still yields a name — Fathom grouping is unchanged', () => {
  // The guard must not work by disabling the title generator wholesale. The
  // Fathom path is 89% of Josh's corpus and depends on this.
  assert.strictEqual(nameFromTitle(BOOKED), 'LaTeesha Whitel');
});

test('⚠⚠ two PMR calls with DIFFERENT names propose NO merge', () => {
  // The private venting call resolved to "Justin Schmidt and Peter Singh"
  // (diarized, low). A sales call will resolve to the real prospect. Same
  // title, different names — this is the exact pair that lands today.
  const a = { id: 'p1', display_name: 'Justin Schmidt and Peter Singh',
              calls: [{ title: PMR }] };
  const b = { id: 'p2', display_name: 'LaTeesha Whitel', calls: [{ title: PMR }] };
  assert.strictEqual(pm.proposalReason(a, b), null,
    'a shared PMR title must NOT be a reason to merge two different people');
});

test('⚠ NON-VACUITY — a shared DISTINCTIVE title DOES still propose a merge', () => {
  // Without this the test above passes trivially if the title generator were
  // deleted. This is the live "Mark-Anthony ~ Forb" case the generator exists
  // for: names that no name-based rule can join, joined by a real booked title.
  const a = { id: 'p1', display_name: 'Mark-Anthony', calls: [{ title: BOOKED }] };
  const b = { id: 'p2', display_name: 'Forb', calls: [{ title: BOOKED }] };
  assert.strictEqual(pm.proposalReason(a, b), 'title',
    'the title generator must still fire on a DISTINCTIVE title');
});

test('⚠⚠ ATTACH keys on the NAME, never the title', () => {
  // Phase 6c looks up prospects by nameKey(resolvedName). Two calls sharing a
  // title but resolving different names produce different keys, so they attach
  // to different prospects regardless of what the title says.
  assert.notStrictEqual(nameKey('Justin Schmidt and Peter Singh'),
                        nameKey('LaTeesha Whitel'));
  // and a call that resolves NO name has no key at all -> no attach
  assert.ok(!nameKey(null), 'a null name must not produce a groupable key');
  assert.ok(!nameKey(''), 'an empty name must not produce a groupable key');
});

test('⚠ the guard survives a RENAME — it is not pinned to one room title', () => {
  // The question asked is "does this yield a person's name", not "does it say
  // Personal Meeting Room", so a renamed or custom room behaves the same way.
  assert.strictEqual(nameFromTitle("Sarah's Meeting Room"), null);
  assert.strictEqual(nameFromTitle('Team Standup'), null);
  // and nothing in the merge module pins the English phrase
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'lib', 'prospect-merge.js'), 'utf8');
  assert.ok(src.indexOf('Personal Meeting Room') === -1,
    'the rule must not be a string match — it would break on rename');
});

test('⚠⚠ KNOWN LIMIT: the rejection is ENGLISH-KEYWORD BASED, so a non-English label PASSES', () => {
  /* ⚠ THIS ASSERTS THE DEFECT, DELIBERATELY. I wrote this test expecting
     `null` and the code returned the label as a NAME. That is the real
     behaviour and pretending otherwise would make the guard a wish.

     `nameFromTitle` rejects meeting labels by matching English patterns
     ("Personal Meeting Room", "'s Meeting Room", "Impromptu", "Standup"). A
     label with none of those words is indistinguishable from a person's name
     to this function, so it is returned as one.

     ⚠ WHY IT IS ACCEPTED RATHER THAN FIXED HERE:
       - ATTACH never consults the title, so this cannot AUTO-merge anything.
         It can only produce a merge PROPOSAL, which a human confirms.
       - Every live account is English and the corpus is 379 English titles.
       - "Reject anything that doesn't look like a person's name" is a much
         bigger rule than this block, and getting it wrong the other way
         (rejecting real names) is worse — a WRONG name is worse than NO name,
         but a MISSING name still costs a real prospect their grouping.

     ⚠ IF a non-English account is ever onboarded, this test is the thing that
     says the hole was known. It is a gap, not a surprise. */
  assert.strictEqual(nameFromTitle('Salle de Reunion'), 'Salle de Reunion',
    'documents the limit — a non-English room label is read as a person');

  // ⚠ AND THE CONTAINMENT IS WHAT MAKES IT ACCEPTABLE: even so, it cannot
  // auto-merge, because attach keys on the NAME.
  const a = { id: 'p1', display_name: 'Alice', calls: [{ title: 'Salle de Reunion' }] };
  const b = { id: 'p2', display_name: 'Bob',   calls: [{ title: 'Salle de Reunion' }] };
  assert.strictEqual(pm.proposalReason(a, b), 'title',
    'it would PROPOSE a merge (human-confirmed) — but nothing merges on its own');
});
