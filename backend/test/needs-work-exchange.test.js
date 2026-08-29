/**
 * "WHAT NEEDS WORK" SHOWS AN EXCHANGE, NOT THREE ORPHAN QUOTES (2026-08-29).
 *
 * ⚠⚠ Justin: "a lot of weak, lazy coaching advice." Measured across all 8 reps:
 * 109 of 118 quotes the panel rendered (92%) are the PROSPECT speaking, and
 * 110 of 118 (93%) had the rep's own reply SITTING IN THE ROW, selected by the
 * query and dropped in buildSectionBreakdown. The panel showed the prospect's
 * words, unlabelled, under a heading about the rep.
 *
 * ⚠ This is the RENDER half only. The two missing parts of the target shape —
 * what they should have asked, and why it would have mattered — exist on 5.8%
 * of moments and need a prompt change, which is NOT wired.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildSectionBreakdown } = require('../lib/section-breakdown');
const LIVE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8')
  .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function hl(over) {
  return Object.assign({
    id: 'h1', fathom_call_id: 'c1', section: 'discovery', type: 'risk_signal',
    speaker: 'PROSPECT', quote: 'we did some research', observation: 'Prospect raised a doubt',
    timestamp_seconds: 60, closer_response: 'Well, we are not dead in the water yet.',
    closer_response_verified: true,
  }, over || {});
}
const META = { c1: { call_date: '2026-08-27', prospect_name: 'Jose', recording_url: 'https://x/y', source: 'fathom' } };

test('the closer\'s line now survives buildSectionBreakdown', () => {
  const out = buildSectionBreakdown('discovery', { analyses: [], highlights: [hl()], callMeta: META });
  const m = out.bad[0];
  assert.ok(m, 'the moment should be in the bad group');
  assert.strictEqual(m.closer_response, 'Well, we are not dead in the water yet.');
  assert.strictEqual(m.closer_response_verified, true);
});

test('⚠ a SENTINEL is never rendered as a reply', () => {
  /* __no_reply__ and __moment_is_closer__ are real stored values. Rendering one
     raw is a recorded defect — displayCloserResponse gates them. */
  ['__no_reply__', '__moment_is_closer__'].forEach(sent => {
    const out = buildSectionBreakdown('discovery', {
      analyses: [], highlights: [hl({ closer_response: sent })], callMeta: META });
    assert.strictEqual(out.bad[0].closer_response, null, sent + ' must not become a reply');
  });
});

test('⚠ the verdict rides WITH the reply — three states, not two', () => {
  /* null = never assessed, false = assessed and not provable, true = proven.
     Collapsing the first two would let a guess render as the rep's words. */
  [[undefined, null], [null, null], [false, false], [true, true]].forEach(([given, want]) => {
    const out = buildSectionBreakdown('discovery', {
      analyses: [], highlights: [hl({ closer_response_verified: given })], callMeta: META });
    assert.strictEqual(out.bad[0].closer_response_verified, want,
      'verified=' + JSON.stringify(given));
  });
});

/* ── the render ────────────────────────────────────────────────────────── */

function renderMoment(m) {
  const at = LIVE.indexOf('function sectionRankMomentHtml');
  assert.ok(at > 0, 'sectionRankMomentHtml is missing — anchor stale');
  const end = LIVE.indexOf('\n  }', at);
  const src = LIVE.slice(at, end + 4);
  assert.ok(src.length > 400 && src.length < 4000, 'slice must cover it: ' + src.length);
  return new Function('escapeHtml', 'dayLabel', 'clipLinkHtml',
    src + '\nreturn sectionRankMomentHtml;')(String, x => x, () => '')(m);
}

test('⚠⚠ THE QUOTE IS LABELLED BY WHO ACTUALLY SPOKE IT', () => {
  /* Unlabelled, under a heading about the rep, a prospect quote reads as the
     rep's words — which for 92% of them was wrong. */
  assert.match(renderMoment({ quote: 'q', speaker: 'PROSPECT' }), /They said/);
  assert.match(renderMoment({ quote: 'q', speaker: 'CLOSER' }), /You said/);
});

test('the reply renders when PROVEN, and is absent when not', () => {
  const proven = renderMoment({ quote: 'q', speaker: 'PROSPECT', closer_response: 'my reply', closer_response_verified: true });
  assert.match(proven, /my reply/);
  assert.match(proven, /srk-reply/);

  /* ⚠ ABSENT, NOT HEDGED. An unverified reply is the model's guess at who
     spoke; attributing it to the rep is the 6b defect. A caveat inside a
     two-line row reads as noise, so it simply does not appear. */
  [false, null, undefined].forEach(v => {
    const out = renderMoment({ quote: 'q', speaker: 'PROSPECT', closer_response: 'my reply', closer_response_verified: v });
    assert.ok(out.indexOf('my reply') === -1, 'unproven reply must not render (verified=' + v + ')');
  });
});

test('the observation renders — it was on the row and shown nowhere', () => {
  assert.match(renderMoment({ quote: 'q', speaker: 'PROSPECT', observation: 'what happened here' }),
    /what happened here/);
  assert.ok(renderMoment({ quote: 'q', speaker: 'PROSPECT' }).indexOf('srk-obs') === -1,
    'and is absent when there is none');
});

test('the panel still names the prospect and the date — evidence must be checkable', () => {
  const out = renderMoment({ quote: 'q', speaker: 'PROSPECT', prospect_name: 'Jose', call_date: '2026-08-27' });
  assert.match(out, /Jose/);
});

test('the lane carries speaker and the reply through to the panel', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8')
    .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = src.indexOf('entry.moments = (bd.bad || [])');
  assert.ok(at > 0, 'the moment map is missing');
  const map = src.slice(at, src.indexOf('});', at));
  ['speaker:', 'closer_response:', 'closer_response_verified:'].forEach(f => {
    assert.ok(map.indexOf(f) !== -1, f + ' must reach the panel');
  });
});
