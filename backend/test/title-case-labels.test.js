/**
 * TITLE CASE ON LABELS — Justin's standing rule (2026-08-17):
 * "when something has a label NEVER use a lowercase letter for the first letter
 * of a word."
 *
 * SCOPE, confirmed by him: rep names, metric names, buttons, headings, chips and
 * axis titles. NOT sentences, and NOT count captions.
 *
 * ⚠⚠ THE EXCEPTION IS HALF THE POINT OF THIS FILE. "2 Of 14 Handled" reads worse
 * than "2 of 14 handled", and an over-eager future tightening of this rule would
 * quietly turn every caption into a headline. So the exception is ASSERTED, not
 * merely un-tested — a sweep that catches captions fails HERE, loudly, instead
 * of shipping.
 *
 * This is the same shape as the no-grey-text rule, which came back twice because
 * the guard was narrower than the intent.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
// ⚠ Comments stripped first — this codebase archives replaced code in place, so
// an old lowercase label survives in a /* */ block long after it stopped
// rendering, and matching it would fail the guard for a label nobody can see.
const LIVE = HTML.split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Static label text only: no interpolation, no entities-as-first-char, short.
function staticLabels(re) {
  return [...LIVE.matchAll(re)]
    .map((m) => m[1].trim())
    .filter((t) => t.length > 1 && t.length <= 60)
    .filter((t) => !/[{}<>+]/.test(t))
    // Drop leading glyphs (arrows, icons) — the rule is about WORDS.
    .map((t) => t.replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(Boolean);
}

// A label is a NAME, not a sentence. Sentences are excluded by the ruling, and
// these are how they announce themselves.
function isSentence(t) {
  return /[.!?]$/.test(t)                       // terminal punctuation
    || /,/.test(t)                              // a clause break
    || t.split(/\s+/).length > 6                // long enough to be prose
    || /^(No|Not|Could not|Nothing|There)\b/.test(t)   // empty/error states
    || /\b(unavailable|yet)$/i.test(t);                // "Highlights unavailable"
}

// ⚠ CONVENTIONAL title case: small connectives stay lowercase INSIDE a label,
// but capitalise when they are the FIRST word ("Call Highlights of the Week",
// but "The Week in Review").
//
// ⚠ AND DO NOT "CORRECT" THIS BACK TO THE LITERAL RULE. Justin's wording —
// "never use a lowercase letter for the first letter of a word" — was aimed at
// LOWERCASE HANDLES like "josh" and a button that just read "call". It was not
// aimed at connectives; "Call Highlights Of The Week" was built, shown to him,
// and ruled against (2026-08-17). The literal reading is the wrong one.
const CONNECTIVES = new Set(['of', 'the', 'to', 'for', 'and', 'a', 'in', 'on']);

function offendingWords(t) {
  return t.split(/\s+/).filter((w, i) => {
    if (i === 0) return /^[a-z]/.test(w);              // first word always capitalises
    if (!/^[a-z]/.test(w)) return false;
    return !CONNECTIVES.has(w.toLowerCase().replace(/[^a-z]/g, ''));
  });
}

test('HEADINGS are Title Case (sentences and empty states excluded)', () => {
  const bad = staticLabels(/<h[123][^>]*>([^<]{2,60})</g)
    .filter((t) => !isSentence(t))
    .filter((t) => offendingWords(t).length);
  assert.deepStrictEqual(bad, [], 'lowercase words in headings: ' + JSON.stringify(bad));
});

test('BUTTON labels are Title Case', () => {
  const bad = staticLabels(/<button[^>]*>([^<]{2,60})</g)
    .filter((t) => !isSentence(t))
    .filter((t) => offendingWords(t).length);
  assert.deepStrictEqual(bad, [], 'lowercase words in buttons: ' + JSON.stringify(bad));
});

// ⚠ ANCHORS STYLED AS BUTTONS. Added 2026-08-17 after the (p) audit found
// lowercase labels this guard STRUCTURALLY COULD NOT SEE: it inspected <h2> and
// <button> only, and Scout renders several controls as <a> with a button class.
// A guard whose scope is narrower than the rule reports success over the part it
// never looked at.
const BUTTON_CLASSES = /class="[^"]*\b(obj-btn|review-why-clip|sec-clip|srk-clip|btn-fathom-primary|btn-fathom-secondary|date-preset)\b[^"]*"/;

function anchorButtonLabels() {
  return [...LIVE.matchAll(/<a\s[^>]*>([^<]{2,60})</g)]
    .filter((m) => BUTTON_CLASSES.test(m[0]))
    .map((m) => m[1].trim())
    // Interpolated labels are decided at runtime — their source is checked
    // where the value is produced (see clip-link-mirror.test.js), not here.
    .filter((t) => !/[{}<>+()]|escapeHtml/.test(t))
    // Strip leading glyphs AND the escaped-unicode form of them.
    .map((t) => t.replace(/\\u[0-9A-Fa-f]{4}/g, '').replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(Boolean);
}

test('ANCHORS styled as buttons are Title Case too', () => {
  const labels = anchorButtonLabels();
  /* ⚠ THE FLOOR MOVED 3 -> 2 ON 2026-09-01, AND IT IS NOT A WEAKENING — the
     POPULATION shrank for a good reason. The digest's clip anchor stopped being
     a literal ("▶ Play Clip") and became clipLabelFor(n.source), so the
     interpolation filter above correctly drops it. That label is pinned harder
     elsewhere: clip-link-mirror.test.js asserts the exact strings ('Clip' /
     'Open Recording', both Title Case) AND that they come from the provider.
     ⚠ The floor is what stops this passing over an empty set, so it must move
     WITH the population and never below it — if it reaches 0 the check is
     measuring nothing and should fail loudly instead. */
  assert.ok(labels.length >= 2, 'expected to actually find anchor-buttons, got ' + labels.length);
  const bad = labels.filter((t) => !isSentence(t)).filter((t) => offendingWords(t).length);
  assert.deepStrictEqual(bad, [], 'lowercase words in anchor-buttons: ' + JSON.stringify(bad));
});

test('⚠ NON-VACUITY — the WIDENED matcher catches a lowercase anchor-button', () => {
  // Same discipline as the heading check: assert the anchor exists first, so a
  // future removal fails loudly instead of turning this into a no-op.
  assert.ok(LIVE.indexOf('>Manage Billing</a>') !== -1, 'non-vacuity anchor is stale');
  const broken = LIVE.replace('>Manage Billing</a>', '>Manage billing</a>');
  const found = [...broken.matchAll(/<a\s[^>]*>([^<]{2,60})</g)]
    .filter((m) => BUTTON_CLASSES.test(m[0]))
    .map((m) => m[1].trim())
    .filter((t) => !/[{}<>+()]|escapeHtml/.test(t))
    .filter((t) => !isSentence(t))
    .filter((t) => offendingWords(t).length);
  assert.ok(found.indexOf('Manage billing') !== -1,
    'the widened matcher must see a reintroduced lowercase anchor-button, or it proves nothing');
});

test('the gauge panel metric names and axis titles are Title Case', () => {
  ['Objection Handling', 'Closing Rate', 'Handle Rate'].forEach(function (label) {
    assert.ok(LIVE.indexOf(label) !== -1, 'expected the Title-Cased label: ' + label);
  });
  // And the lowercase forms are gone from the live path.
  ['\'Objection handling\'', '\'Closing rate\'', '\'Handle rate\''].forEach(function (old) {
    assert.strictEqual(LIVE.indexOf(old), -1, 'lowercase label still live: ' + old);
  });
});

test('⚠⚠ THE COUNT-CAPTION EXCEPTION STILL EXISTS — do not "fix" these', () => {
  // If a future sweep title-cases these, this fails and says why. "2 Of 14
  // Handled" is worse than "2 of 14 handled"; the caption is evidence under a
  // number, not a label on a control.
  // ⚠ ANCHOR RE-POINTED 2026-08-18. This read the per-rep gauge caption
  // (' of ' + d.total + ' ' + m.unit), which went with that panel — the third
  // time in this file a removal has quietly emptied an anchor. The team-averages
  // caption is the same kind of text and carries the exception forward.
  assert.ok(/' of ' \+ m\.total \+ ' ' \+ m\.unit_name/.test(LIVE),
    'the team-averages raw-count caption must stay lowercase');
  assert.ok(/'across ' \+ m\.total \+ ' call'/.test(LIVE),
    'the call-time sample caption must stay lowercase');
  // ⚠ The rep-count sentence is composed SERVER-SIDE (lib/team-averages.js
  // countSentence) and reaches the page as data, so it is not in this HTML and
  // asserting on LIVE here would pass vacuously forever. Checked at its source.
  const TA = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-averages.js'), 'utf8');
  assert.ok(/at or above target/.test(TA) && /not enough calls/.test(TA),
    'the rep-count sentence is a caption, not a label — it stays lowercase');
});

test('CONNECTIVES stay lowercase inside a label, and capitalise as the first word', () => {
  assert.deepStrictEqual(offendingWords('Call Highlights of the Week'), [],
    'of/the are connectives — conventional title case leaves them');
  assert.deepStrictEqual(offendingWords('Add to Knowledge Base'), []);
  assert.deepStrictEqual(offendingWords('Copy for Slack'), []);
  // First word capitalises like anything else.
  assert.deepStrictEqual(offendingWords('the Week in Review'), ['the']);
  // A non-connective lowercase word is still a failure.
  assert.deepStrictEqual(offendingWords('Recent calls'), ['calls']);
  assert.deepStrictEqual(offendingWords('Add rep'), ['rep']);
  // And the label Justin's rule WAS aimed at.
  assert.deepStrictEqual(offendingWords('call'), ['call']);
});

test('⚠ NON-VACUITY — the matcher actually catches a lowercase label', () => {
  // ⚠ ANCHOR: pick a heading that still exists. This originally broke
  // "Recent Calls", which item (n) removed — the test then proved nothing
  // because the replace was a no-op. Assert the anchor is present first, so
  // the next removal fails loudly instead of quietly emptying this check.
  assert.ok(LIVE.indexOf('<h2>Coach Summary<') !== -1, 'non-vacuity anchor is stale');
  const broken = LIVE.replace('<h2>Coach Summary<', '<h2>Coach summary<');
  const bad = [...broken.matchAll(/<h[123][^>]*>([^<]{2,60})</g)]
    .map((m) => m[1].trim())
    .filter((t) => !/[{}<>+]/.test(t))
    .filter((t) => !isSentence(t))
    .filter((t) => offendingWords(t).length);
  assert.ok(bad.indexOf('Coach summary') !== -1,
    'the matcher must see a reintroduced lowercase heading, or this proves nothing');
});

test('the sentence exclusion is real, not a hole that swallows everything', () => {
  // If isSentence() matched too much, the guards above would pass vacuously.
  assert.strictEqual(isSentence('Recent Calls'), false);
  assert.strictEqual(isSentence('Add Rep'), false);
  assert.strictEqual(isSentence('No analyzed calls yet'), true);
  assert.strictEqual(isSentence('Could not load this section'), true);
  assert.strictEqual(isSentence('Two calls, for contrast'), true);
  assert.strictEqual(isSentence('Highlights unavailable'), true, 'an error state, not a label');
  // and it must leave real labels to be checked
  const checked = staticLabels(/<h[123][^>]*>([^<]{2,60})</g).filter((t) => !isSentence(t));
  assert.ok(checked.length >= 8, 'expected the guard to actually check labels, got ' + checked.length);
});
