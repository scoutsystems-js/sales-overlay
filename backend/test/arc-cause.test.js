// The capture of causes — the closer's ARC behind a buying signal (H718/H719).
//
// Justin's rulings, executed here:
//   • the vocabulary of moves is a CLOSED set of sixteen; a move that does not
//     fit is `none`, never a new name;
//   • the unit is the closer's arc, evidenced by TWO OR THREE verbatim closer
//     lines, each located in the stored transcript; ONE unlocatable line
//     refuses the whole cause, stored as `none — not_evidenced` (in public,
//     never a silent drop);
//   • `none — arrived_pre_sold` is a feature: the closer earned nothing;
//   • the disclosure tier (let it slide · dug deeper · banked and used) needs
//     both ends: `banked_and_used` requires a located callback AFTER the moment.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const arc = require('../lib/arc-cause');
const { labelForQuote } = require('../lib/quote-locate');
const W = require('../lib/analysis-worker');
const { selectHarvestMoments } = require('../lib/kb-harvest');
const { buildMomentRow } = require('../lib/kb-entry');

// A planted transcript: the closer builds pain with three questions, the
// prospect gives a buying signal at 300s, and the closer calls back a
// disclosure at 2,000s.
const TURNS = [
  { speaker: 'PROSPECT', text: 'I have been watching him for a year now honestly', start_seconds: 40 },
  { speaker: 'CLOSER', text: 'A year? What took you so long to book a call with us then?', start_seconds: 45 },
  { speaker: 'CLOSER', text: 'So what happens to your family if nothing changes in the next twelve months?', start_seconds: 120 },
  { speaker: 'PROSPECT', text: 'I mean it would be bad, we are barely making it', start_seconds: 130 },
  { speaker: 'CLOSER', text: 'And how long have you been telling yourself that it will get better on its own?', start_seconds: 180 },
  { speaker: 'PROSPECT', text: 'Too long. Probably three years now if I am honest', start_seconds: 190 },
  { speaker: 'CLOSER', text: 'What would it actually cost you to stay exactly where you are right now?', start_seconds: 240 },
  { speaker: 'PROSPECT', text: 'You are right, I need to do something to fix this', start_seconds: 300 },
  { speaker: 'CLOSER', text: 'John, you told me earlier you have been watching him for a year and now you want to think about it', start_seconds: 2000 },
];
const SIGNAL_TS = 300;
const Q = {
  a: 'So what happens to your family if nothing changes in the next twelve months?',
  b: 'And how long have you been telling yourself that it will get better on its own?',
  c: 'What would it actually cost you to stay exactly where you are right now?',
  prospect: 'I mean it would be bad, we are barely making it',
  callback: 'John, you told me earlier you have been watching him for a year and now you want to think about it',
  dig: 'A year? What took you so long to book a call with us then?',
};

test('the vocabulary is the closed sixteen, grouped as Justin approved', () => {
  assert.deepStrictEqual(arc.MOVES.discovery, ['digging for pain', 'uncovering goals', 'establishing why now', 'screening decision makers', 'qualifying financially', 'mapping the current situation']);
  assert.deepStrictEqual(arc.MOVES.objections, ['isolating', 'normalising the fear', 'naming the fear', 'reframing', 'booking the follow-up', 'testing the smokescreen']);
  assert.deepStrictEqual(arc.MOVES.pitch_and_close, ['anchoring price', 'asking for the sale', 'handling the partner', 'confirming understanding']);
  assert.strictEqual(arc.ALL_MOVES.length, 16);
  assert.strictEqual(new Set(arc.ALL_MOVES).size, 16);
});

test('two or three located closer lines keep the move; the arc start is the earliest line', () => {
  const out = arc.verifyCause({ move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 180, quote: Q.b }, { timestamp_seconds: 240, quote: Q.c }], summary: 'Built up the pain with hard questions until the prospect admitted he needs to change.' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(out.move, 'digging for pain');
  assert.strictEqual(out.none_reason, null);
  assert.strictEqual(out.evidence.length, 3);
  assert.strictEqual(out.arc_start_seconds, 120);
  assert.ok(out.evidence.every((e) => e.located === true));
});

test('ONE unlocatable line refuses the WHOLE cause, in public: none — not_evidenced with the claim recorded', () => {
  const out = arc.verifyCause({ move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 180, quote: 'How long have you told yourself things will improve?' }], summary: 's' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(out.move, 'none');
  assert.strictEqual(out.none_reason, 'not_evidenced');
  assert.strictEqual(out.refused.move, 'digging for pain');
  assert.strictEqual(out.refused.unlocated, 1);
  assert.strictEqual(out.evidence, null);
});

test('a PROSPECT line offered as closer evidence refuses the cause; one line is not evidence; four lines keep three', () => {
  const bad = arc.verifyCause({ move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 130, quote: Q.prospect }], summary: 's' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(bad.move, 'none'); assert.strictEqual(bad.none_reason, 'not_evidenced');
  const one = arc.verifyCause({ move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }], summary: 's' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(one.move, 'none'); assert.strictEqual(one.none_reason, 'not_evidenced');
  const four = arc.verifyCause({ move: 'digging for pain', evidence: [{ timestamp_seconds: 45, quote: Q.dig }, { timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 180, quote: Q.b }, { timestamp_seconds: 240, quote: Q.c }], summary: 's' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(four.move, 'digging for pain'); assert.strictEqual(four.evidence.length, 3);
});

test('a line AFTER the signal is not its cause; a line outside eight minutes is not its arc', () => {
  const after = arc.verifyCause({ move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 2000, quote: Q.callback }], summary: 's' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(after.move, 'none');
  const far = arc.verifyCause({ move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 180, quote: Q.b }], summary: 's' }, TURNS, 120 + arc.WIDENED_WINDOW_SECONDS + 100, labelForQuote);
  assert.strictEqual(far.move, 'none');
});

test('a move outside the vocabulary is none — not_in_vocabulary, never a new name', () => {
  const out = arc.verifyCause({ move: 'building rapport', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 180, quote: Q.b }], summary: 's' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(out.move, 'none');
  assert.strictEqual(out.none_reason, 'not_in_vocabulary');
  assert.strictEqual(out.refused.move, 'building rapport');
});

test('none — arrived_pre_sold is kept as a result with no evidence required; an unknown reason becomes no_closer_work', () => {
  const pre = arc.verifyCause({ move: 'none', none_reason: 'arrived_pre_sold', summary: 'The prospect arrived having done five pages of notes on the program.' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(pre.move, 'none'); assert.strictEqual(pre.none_reason, 'arrived_pre_sold'); assert.strictEqual(pre.evidence, null);
  const odd = arc.verifyCause({ move: 'none', none_reason: 'whatever' }, TURNS, SIGNAL_TS, labelForQuote);
  assert.strictEqual(odd.none_reason, 'no_closer_work');
});

test('an unmatched transcript (labels are guesses) refuses every claimed move', () => {
  const raw = TURNS.map((t) => Object.assign({}, t, { speaker: t.speaker === 'CLOSER' ? 'Josh' : 'Scottie' }));
  const out = arc.verifyCause({ move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 180, quote: Q.b }], summary: 's' }, raw, SIGNAL_TS, labelForQuote);
  assert.strictEqual(out.move, 'none'); assert.strictEqual(out.none_reason, 'not_evidenced');
});

test('the disclosure tier: banked_and_used needs a located callback AFTER the moment; dug_deeper a located question; let_it_slide nothing', () => {
  const banked = arc.verifyDisclosure({ tier: 'banked_and_used', response: { timestamp_seconds: 45, quote: Q.dig }, callback: { timestamp_seconds: 2000, quote: Q.callback } }, TURNS, 40, labelForQuote);
  assert.strictEqual(banked.tier, 'banked_and_used'); assert.strictEqual(banked.callback.timestamp_seconds, 2000);
  const noCallback = arc.verifyDisclosure({ tier: 'banked_and_used', callback: { timestamp_seconds: 2000, quote: 'you told me you had been watching for ages' } }, TURNS, 40, labelForQuote);
  assert.strictEqual(noCallback.tier, null); assert.strictEqual(noCallback.none_reason, 'not_evidenced'); assert.strictEqual(noCallback.refused.tier, 'banked_and_used');
  const before = arc.verifyDisclosure({ tier: 'banked_and_used', callback: { timestamp_seconds: 45, quote: Q.dig } }, TURNS, 300, labelForQuote);
  assert.strictEqual(before.tier, null);
  const dug = arc.verifyDisclosure({ tier: 'dug_deeper', response: { timestamp_seconds: 45, quote: Q.dig } }, TURNS, 40, labelForQuote);
  assert.strictEqual(dug.tier, 'dug_deeper');
  const slide = arc.verifyDisclosure({ tier: 'let_it_slide' }, TURNS, 40, labelForQuote);
  assert.strictEqual(slide.tier, 'let_it_slide');
  const unknown = arc.verifyDisclosure({ tier: 'crushed it' }, TURNS, 40, labelForQuote);
  assert.strictEqual(unknown.tier, null); assert.strictEqual(unknown.none_reason, 'not_in_vocabulary');
});

test('the KB text gains the move and the summary and stays short — a field, never a longer chunk', () => {
  const txt = arc.causeContentText({ move: 'digging for pain', none_reason: null, summary: 'Built up the pain with hard questions like what happens to your family and what it costs to stay put until the prospect admitted he needs to change.' });
  assert.ok(/digging for pain/.test(txt));
  assert.ok(txt.length <= arc.CAUSE_TEXT_MAX_CHARS, 'cause text ' + txt.length + ' > ' + arc.CAUSE_TEXT_MAX_CHARS);
  assert.strictEqual(arc.causeContentText({ move: 'none', none_reason: 'arrived_pre_sold', summary: 'Arrived pre-sold.' }).indexOf('arrived pre-sold') >= 0, true);
  assert.strictEqual(arc.causeContentText(null), '');
});

test('the window: five minutes, widened once to eight when fewer than two closer questions sit inside it', () => {
  const w5 = arc.windowTurns(TURNS, SIGNAL_TS);
  assert.strictEqual(w5.seconds, arc.WINDOW_SECONDS);
  assert.ok(w5.turns.every((t) => t.start_seconds <= SIGNAL_TS && t.start_seconds >= SIGNAL_TS - arc.WINDOW_SECONDS));
  const sparse = [{ speaker: 'CLOSER', text: 'Why now?', start_seconds: 10 }, { speaker: 'CLOSER', text: 'What changed for you?', start_seconds: 20 }, { speaker: 'PROSPECT', text: 'I want in', start_seconds: 400 }];
  const w8 = arc.windowTurns(sparse, 400);
  assert.strictEqual(w8.seconds, arc.WIDENED_WINDOW_SECONDS);
  assert.strictEqual(w8.turns.length, 3);
});

// ── the worker wiring (executed, then pinned) ──────────────────────────────
test('sanitizeHighlights carries a cause on a buying signal and a disclosure tier on a prospect moment, and never invents one', () => {
  const raw = [
    { timestamp_seconds: 300, speaker: 'PROSPECT', quote: 'You are right, I need to do something to fix this', observation: 'o', type: 'buying_signal', section: 'discovery', closer_response: '__no_reply__', cause: { move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 180, quote: Q.b }], summary: 's' } },
    { timestamp_seconds: 40, speaker: 'PROSPECT', quote: 'I have been watching him for a year now honestly', observation: 'o', type: 'risk_signal', section: 'discovery', handling: 'addressed', closer_response: Q.dig, disclosure_handling: { tier: 'banked_and_used', callback: { timestamp_seconds: 2000, quote: Q.callback } } },
    { timestamp_seconds: 500, speaker: 'CLOSER', quote: 'What would it actually cost you to stay exactly where you are right now?', observation: 'o', type: 'strong_moment', section: 'discovery', closer_response: '__moment_is_closer__', cause: { move: 'digging for pain', evidence: [], summary: 's' } },
  ];
  const s = W._sanitizeHighlights(raw, 3000);
  assert.strictEqual(s.length, 3);
  assert.strictEqual(s[0].cause.move, 'digging for pain');
  assert.strictEqual(s[1].disclosure_handling.tier, 'banked_and_used');
  assert.strictEqual(s[2].cause, null, 'a cause belongs to a buying signal only');
  assert.strictEqual(s[0].disclosure_handling, null, 'no tier was offered, none is invented');
});

test('attachArcFields verifies every claim against the transcript and returns a NEW array (a caller that drops the result keeps nothing)', () => {
  const s = W._sanitizeHighlights([
    { timestamp_seconds: 300, speaker: 'PROSPECT', quote: 'You are right, I need to do something to fix this', observation: 'o', type: 'buying_signal', section: 'discovery', cause: { move: 'digging for pain', evidence: [{ timestamp_seconds: 120, quote: Q.a }, { timestamp_seconds: 180, quote: 'a paraphrase that is not in the transcript at all' }], summary: 's' } },
    { timestamp_seconds: 40, speaker: 'PROSPECT', quote: 'I have been watching him for a year now honestly', observation: 'o', type: 'risk_signal', section: 'discovery', disclosure_handling: { tier: 'banked_and_used', callback: { timestamp_seconds: 2000, quote: Q.callback } } },
  ], 3000);
  const out = W._attachArcFields(s, TURNS, 'matched');
  assert.notStrictEqual(out, s);
  assert.strictEqual(s[0].cause.move, 'digging for pain', 'the input is not mutated');
  assert.strictEqual(out[0].cause.move, 'none');
  assert.strictEqual(out[0].cause.none_reason, 'not_evidenced');
  assert.strictEqual(out[1].disclosure_handling.tier, 'banked_and_used');
  const unmatched = W._attachArcFields(s, TURNS, 'inferred');
  assert.strictEqual(unmatched[1].disclosure_handling.tier, null);
});

test('analyzeCall ASSIGNS attachArcFields before persisting (pin — the executed half is above)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  const { stripComments } = require('../sweep/strip');
  const s = stripComments(src);
  const fn = s.indexOf('async function analyzeCall(');
  assert.ok(fn > 0);
  const assign = s.indexOf('sanitizedHighlights = attachArcFields(sanitizedHighlights, normalized.turns, normalized.speaker_confidence)', fn);
  const persist = s.indexOf('persistHighlights(admin, fathomCallId, userId, sanitizedHighlights)', fn);
  assert.ok(assign > fn, 'the assignment is missing');
  assert.ok(persist > assign, 'the assignment must come before the persist');
});

test('persistHighlights writes the two columns (executed against a fake wire)', async () => {
  const written = [];
  const admin = { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }), insert: async (rows) => { written.push(...rows); return { error: null }; }, delete: () => ({ in: async () => ({ error: null }) }) }) };
  await W._persistHighlights(admin, 'call-1', 'user-1', [{ timestamp_seconds: 1, speaker: 'PROSPECT', quote: 'q', observation: 'o', type: 'buying_signal', cause: { move: 'none', none_reason: 'arrived_pre_sold' }, disclosure_handling: null }]);
  assert.strictEqual(written.length, 1);
  assert.strictEqual(written[0].cause.none_reason, 'arrived_pre_sold');
  assert.ok('disclosure_handling' in written[0]);
});

test('v41: the prompt lists the sixteen moves (derived, not typed twice), the version is bumped, the cap is 4500', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');
  assert.match(src, /ANALYSIS_PROMPT_VERSION = 'v45-2026-09-05'/);
  assert.match(src, /HIGHLIGHT_MAX_TOK\s*=\s*4500/);
  const prompt = W._buildHighlightExtractorPrompt({ turns: TURNS, speaker_confidence: 'matched' });
  arc.ALL_MOVES.forEach((m) => assert.ok(prompt.indexOf(m) !== -1, 'prompt lacks ' + m));
  assert.ok(/arrived_pre_sold/.test(prompt));
  assert.ok(/banked_and_used/.test(prompt));
  assert.ok(prompt.indexOf(arc.causePromptBlock()) !== -1, 'the prompt block is the lib\'s, not a copy');
  assert.ok(prompt.indexOf(arc.disclosurePromptBlock()) !== -1, 'the disclosure block is the lib\'s, not a copy');
});

// ── the harvest and the KB row ─────────────────────────────────────────────
test('a PROSPECT buying signal with an EVIDENCED cause is harvested (its closer material is the located lines); with none it is not', () => {
  const base = { section: 'discovery', type: 'buying_signal', speaker: 'PROSPECT', speaker_verified: true, quote: 'You are right, I need to do something to fix this' };
  const evidenced = Object.assign({}, base, { cause: { move: 'digging for pain', none_reason: null, evidence: [{ timestamp_seconds: 120, quote: Q.a, located: true }, { timestamp_seconds: 180, quote: Q.b, located: true }] } });
  const none = Object.assign({}, base, { cause: { move: 'none', none_reason: 'arrived_pre_sold', evidence: null } });
  const unverified = Object.assign({}, evidenced, { speaker_verified: false });
  assert.strictEqual(selectHarvestMoments([evidenced]).length, 1);
  assert.strictEqual(selectHarvestMoments([none]).length, 0);
  assert.strictEqual(selectHarvestMoments([unverified]).length, 0);
  assert.strictEqual(selectHarvestMoments([base]).length, 0, 'the closer bar still holds without a cause');
});

test('the KB row carries the cause and the tier in metadata and the move in its text', () => {
  const row = buildMomentRow({ highlight: { section: 'discovery', type: 'buying_signal', speaker: 'PROSPECT', speaker_verified: true, quote: 'q', observation: 'o', timestamp_seconds: 300, cause: { move: 'digging for pain', none_reason: null, evidence: [{ timestamp_seconds: 120, quote: Q.a, located: true }, { timestamp_seconds: 180, quote: Q.b, located: true }], arc_start_seconds: 120, summary: 'Built up the pain with hard questions until he admitted he needs to change.' }, disclosure_handling: { tier: 'dug_deeper' } }, target: { scope: 'personal', team_owner_id: null, uploaded_by: 'u' }, fathomCallId: 'c', source: 'auto_closed_call', sourceUserId: 'u' });
  assert.strictEqual(row.metadata.cause.move, 'digging for pain');
  assert.strictEqual(row.metadata.disclosure_handling.tier, 'dug_deeper');
  assert.ok(/digging for pain/.test(row.content));
  const plain = buildMomentRow({ highlight: { section: 'discovery', type: 'strong_moment', speaker: 'CLOSER', quote: 'q', observation: 'o' }, target: { scope: 'personal', team_owner_id: null, uploaded_by: 'u' }, fathomCallId: 'c', source: 'auto_closed_call', sourceUserId: 'u' });
  assert.strictEqual(plain.metadata.cause, null);
  assert.strictEqual(plain.metadata.disclosure_handling, null);
});
