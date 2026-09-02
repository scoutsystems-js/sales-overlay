'use strict';
/* ⚠⚠ TEAM RECOMMENDATIONS — OPTION A (2026-09-01).
   Three beats: claim -> evidence -> quote, with the attribution ABOVE the quote
   and BOUND to it. Previously the rep and clip sat in a FOOTER BELOW the quote,
   so a reader met the quote before anything saying whose it was.
   ⚠⚠ THE PROPERTY THIS FILE EXISTS TO PROTECT: NO WRONG LABEL IS EVER SHOWN.
   `rep` means "whose CALL", not "who SPOKE" — the quote is either the closer's
   PROVEN reply or the prospect's line. A row with no recorded speaker falls back
   to B (inline, unlabelled) rather than guessing. Do not weaken that. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIB  = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');

/* ⚠ LINE COMMENTS FIRST — a `/*` inside a `//` line is a false opener that
   pairs with the next real closer and swallows everything between. */
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function slice(start, end, floor) {
  const a = HTML.indexOf(start);
  assert.ok(a !== -1, 'anchor missing (stale?): ' + start);
  const b = HTML.indexOf(end, a);                       // ⚠ fromIndex, or the slice runs backwards
  assert.ok(b !== -1, 'end marker missing after anchor');
  const t = HTML.slice(a, b + end.length);
  assert.ok(t.length > floor && t.length < 8000, 'slice must cover the function: ' + t.length);
  return t;
}

function renderer() {
  const src = slice('function tsFromClipUrl', '\n  }', 150) + '\n'
            + slice('function teamInsightHtml', '\n  }', 1200);
  const escapeHtml = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  /* Fixture, not product: the renderer now asks whether the viewer may fine-tune
     (2026-09-02). A real page has these; the harness supplies them. */
  const canMarkStandard = () => false;
  const state = { correctedMomentIds: {} };
  void canMarkStandard; void state;
  const displayNameFromEmail = (a) => (a === 'Joshua Pinner' ? 'Josh P' : a);
  const clipLabelFor = (s) => (s === 'zoom' ? 'Open Recording' : 'Clip');
  /* ⚠ THE FILE IS STRICT, AND A STRICT eval SCOPES FUNCTION DECLARATIONS TO
     ITSELF — assigning to outer `let`s silently leaves them undefined. Return
     them from a trailing expression instead. */
  return eval(src + '\n({ teamInsightHtml: teamInsightHtml, tsFromClipUrl: tsFromClipUrl })');
}

const BASE = { rep: 'Joshua Pinner', source: 'fathom',
  clip_url: 'https://fathom.video/calls/805201141?t=2022',
  claim: 'A claim.', data: 'Some evidence.' };

test('A · a PROVEN closer reply is attributed to the rep, above the quote', () => {
  const { teamInsightHtml } = renderer();
  const h = teamInsightHtml(Object.assign({}, BASE, { quote: 'keep the cash.', spoke: 'closer' }), 'working');
  assert.ok(h.indexOf('team-insight-ev') !== -1, 'the pair sits in one container');
  assert.ok(h.indexOf('>Josh P<') !== -1 || /team-insight-who">Josh P/.test(h), 'the rep is named');
  assert.ok(h.indexOf('33:42') !== -1, 'and the moment is timed');
  // ⚠ ORDER IS THE WHOLE POINT — attribution BEFORE the quote, not after it.
  assert.ok(h.indexOf('team-insight-who') < h.indexOf('review-why-quote'), 'attribution must come FIRST');
  assert.strictEqual(h.indexOf('team-insight-foot'), -1, 'the footer is gone when the quote is attributed');
});

test('⚠⚠ A · a PROSPECT line is NEVER labelled with the rep speaking', () => {
  const { teamInsightHtml } = renderer();
  const h = teamInsightHtml(Object.assign({}, BASE, { quote: 'I must ask my wife.', spoke: 'prospect' }), 'working');
  assert.ok(h.indexOf('The prospect') !== -1, 'it says who actually spoke');
  // the rep still appears, but as WHOSE CALL it was — never as the speaker
  assert.ok(/The prospect, on Josh P’s call/.test(h), 'the rep is the CALL owner, not the speaker');
});

test('⚠⚠ B · a row with NO recorded speaker runs INLINE and is never labelled', () => {
  const { teamInsightHtml } = renderer();
  const h = teamInsightHtml(Object.assign({}, BASE, { quote: 'keep the cash.' }), 'working');   // no `spoke`
  assert.ok(h.indexOf('team-insight-inline-q') !== -1, 'B: the quote runs inline');
  assert.strictEqual(h.indexOf('team-insight-who'), -1, '⚠ NO attribution line — we do not know who spoke');
  assert.strictEqual(h.indexOf('The prospect'), -1, 'and no guess in either direction');
  assert.ok(h.indexOf('team-insight-foot') !== -1, 'the rep tag survives as call context');
});

test('an insight with no quote still names the call it came from', () => {
  const { teamInsightHtml } = renderer();
  const h = teamInsightHtml(Object.assign({}, BASE, { quote: '' }), 'working');
  assert.ok(h.indexOf('team-rep-tag') !== -1);
  assert.strictEqual(h.indexOf('review-why-quote'), -1);
});

test('the timestamp is parsed from the clip URL, so OLD cached rows get one too', () => {
  const { tsFromClipUrl } = renderer();
  /* ⚠ CONVERTED 2026-09-01: this pinned `mm:ss`, which let minutes run past
     sixty — a moment at 7,660s rendered "127:40" on a live page. The rest of
     the product uses hh:mm:ss and hmsOf already did. The SUBJECT survives: a
     timestamp is derived from the clip URL so old cached rows get one too. */
  assert.strictEqual(tsFromClipUrl('https://x/y?t=2022'), '00:33:42');
  assert.strictEqual(tsFromClipUrl('https://x/y?t=0'), '00:00:00');
  assert.strictEqual(tsFromClipUrl('https://x/y?t=7660'), '02:07:40',
    '⚠ minutes must never run past sixty — this is the regression');
  assert.strictEqual(tsFromClipUrl('https://x/y'), '', 'no t= -> no time, not a fake one');
  assert.strictEqual(tsFromClipUrl(null), '');
});

/* ── the backend half ─────────────────────────────────────────────────────── */

test('⚠⚠ the SIXTH unproven-reply lane is closed: this lane uses the VERIFIED gate', () => {
  const live = stripComments(LIB);
  assert.ok(live.indexOf('provenCloserResponse') !== -1, 'imported and used');
  assert.ok(live.indexOf('closer_response_verified') !== -1,
    'and the flag is SELECTED — without it the gate can never pass');
  // the recommendations candidate must not fall back to the sentinel-only gate
  const cand = live.slice(live.indexOf('var candidates = hlRows.map'));
  const upto = cand.slice(0, cand.indexOf('.filter('));
  assert.strictEqual(upto.indexOf('displayCloserResponse'), -1,
    '⚠ this lane feeds a MODEL and renders to a MANAGER — sentinel-only is not enough here');
});

test('⚠ who spoke is RECORDED where the || decides it — nothing downstream can recover it', () => {
  const live = stripComments(LIB);
  /* ⚠⚠ CONVERTED 2026-09-01, AND THIS GUARD PINNED THE DEFECT AS CORRECT.
     It asserted `spoke: reply ? 'closer' : ...` — deriving the speaker from
     WHICH FIELD the code fell back to. `closer_response` is definitionally the
     closer, but `quote` is EITHER, so that branch carried no information about
     who spoke, and a closer's line was rendered as the prospect's on a live
     page. The recorded `call_highlights.speaker` is now read instead.
     ⚠ THE SUBJECT SURVIVES: who spoke must be captured at the producer, because
     nothing downstream can recover it. Only the SOURCE changed. */
  assert.ok(/spoke:\s*spokeOf\(r, reply, /.test(live),
    'the speaker is READ from the row, not inferred from the branch taken');
  assert.strictEqual(/spoke:\s*reply\s*\?\s*'closer'\s*:/.test(live), false,
    'the which-field-did-I-use derivation must not come back');
  assert.ok(/spoke:\s*ev\s*\?\s*\(ev\.spoke/.test(live), 'and carried through resolve() to the payload');
});

test('⚠⚠ the caps BOUND A RUNAWAY rather than truncating normal output', () => {
  const live = stripComments(LIB);
  // a length rule must exist for the cap to sit above
  assert.ok(/LENGTH: keep each "claim"/.test(live), 'the prompt states a length rule');
  const m = /const CLAIM_CAP = (\d+)/.exec(live), d = /const DATA_CAP\s+= (\d+)/.exec(live);
  assert.ok(m && d, 'both caps are named constants');
  // 45 words is ~290 chars; the cap must be comfortably ABOVE it, never on it
  assert.ok(Number(m[1]) >= 450, 'claim cap must sit above the stated 45-word rule, got ' + m[1]);
  assert.ok(Number(d[1]) >= 450, 'data cap must sit above the stated 45-word rule, got ' + d[1]);
  assert.strictEqual(live.indexOf('str(it && it.claim, 400)'), -1, 'the old truncating cap is gone');
});

test('capAtSentence cuts at a sentence end, and never mid-word without saying so', () => {
  const live = stripComments(LIB);
  const src = live.slice(live.indexOf('function capAtSentence'));
  const capAtSentence = eval(src.slice(0, src.indexOf('\n}') + 2) + '\ncapAtSentence');
  assert.strictEqual(capAtSentence('Short.', 500), 'Short.', 'under the cap: untouched');
  assert.strictEqual(capAtSentence('First sentence here. Then a much longer second one that runs on.', 40),
    'First sentence here.', 'cuts at the sentence end, not mid-clause');
  // no usable sentence end -> word boundary AND an ellipsis, so the cut is visible
  const original = 'Averylongunbrokenrun of words with no sentence end at all here';
  const hard = capAtSentence(original, 30);
  assert.ok(/…$/.test(hard), 'a hard cut must SAY it was cut');
  /* ⚠ MY FIRST VERSION OF THIS ASSERTION WAS WRONG, NOT THE CODE: /\w…$/ is
     ALWAYS true when you cut at a word boundary, because the character before
     the ellipsis is the last letter of a complete word. The real property is
     that the kept text ends where the ORIGINAL has a space — i.e. no word was
     sliced through. */
  const kept = hard.slice(0, -1);
  assert.ok(original.startsWith(kept), 'the kept text is a real prefix of the original');
  assert.strictEqual(original.charAt(kept.length), ' ',
    'the cut lands ON a space in the original — no word is sliced through');
  assert.strictEqual(capAtSentence(null, 10), null);
  assert.strictEqual(capAtSentence('   ', 10), null, 'blank is null, not an empty string');
});

test('⚠⚠ the lane version is IN the cache key — or this change ships nothing', () => {
  const live = stripComments(LIB);
  assert.ok(/const RECS_LANE_VERSION = '/.test(live), 'the lane has a version');
  /* ⚠ DECLARING IT IS NOT ENOUGH — it has to be in the HASH. The generated text
     lives inside the cached payload, so a key that does not move leaves every
     cached window serving the old, cut-off, unattributed text indefinitely. */
  const hash = live.slice(live.indexOf('var hash = crypto.createHash'));
  const upto = hash.slice(0, hash.indexOf(".digest('hex')"));
  assert.ok(upto.length > 50 && upto.length < 2000, 'hash slice sane: ' + upto.length);
  assert.ok(upto.indexOf('RECS_LANE_VERSION') !== -1,
    'the version must be folded INTO the key, not merely declared beside it');
});
