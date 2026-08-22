/**
 * THE COACHING SUMMARY, AS RENDERED.
 *
 * ⚠ The lib tests pin what reaches the model and what is allowed back. These
 * pin what a manager actually sees — because a correct payload rendered by a
 * function nothing calls is the dead-call-site failure, and this project has
 * shipped it before.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* ⚠ strip comments FIRST, and LINE comments before BLOCK comments: this file
   archives removed code in place and explains its own rules in prose, so a raw
   match reports the explanation as the code. A `/*` inside a `//` line is a
   false opener that swallows everything to the next close delimiter. */
const LIVE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Slice a function out of the page. fromIndex is not optional — see below. */
function slice(name, endMarker) {
  const at = LIVE.indexOf(name);
  assert.ok(at > -1, 'stale anchor: ' + name + ' not found');
  // ⚠ fromIndex ALWAYS. `indexOf(end)` without it finds the first occurrence in
  // the whole file, which is frequently BEFORE the function — and
  // `slice(bigger, smaller)` returns '', which then passes every negative
  // assertion vacuously.
  const end = LIVE.indexOf(endMarker, at);
  assert.ok(end > at, 'end marker for ' + name + ' not found after it');
  const src = LIVE.slice(at, end + endMarker.length);
  assert.ok(src.length > 120 && src.length < 9000, name + ' slice length ' + src.length);
  return src;
}

/* ── the invalidation bug the drilldown shipped with ──────────────────────── */

test('⚠⚠ resetTeamData CLEARS THE DRILLDOWN LANES — the picker calls it', () => {
  /* The date picker's setter calls resetTeamData(). It did not clear
     teamObjections or teamObjSummary, so changing the range on #team-objections
     relabelled the picker while the grid, the moments and the summary all kept
     the PREVIOUS range's numbers. Nothing errors — the screen just disagrees
     with its own control, which is the two-numbers-on-one-screen failure with
     one of them being a date. */
  const src = slice('function resetTeamData', '\n  }');
  ['teamObjections', 'teamObjSummary'].forEach((k) => {
    assert.ok(new RegExp('state\\.' + k + '\\s*=\\s*null').test(src),
      k + ' must be reset when the team or range changes, or a stale range renders as current');
  });

  // and the picker must genuinely route through it, or the test above is moot
  const picker = slice('function ensureTeamPicker', '\n  }');
  assert.ok(picker.indexOf('resetTeamData()') !== -1,
    'the picker must call resetTeamData — otherwise clearing lanes there proves nothing');
});

test('⚠ a CATEGORY chip does NOT invalidate the summary — that would bill a call per click', () => {
  const src = slice('function setObjDrillCategory', '\n  }');
  assert.ok(src.indexOf('state.teamObjections = null') !== -1, 'the moment list DOES refetch');
  assert.strictEqual(src.indexOf('state.teamObjSummary = null'), -1,
    'the summary covers every category — clearing it on a chip click fires a fresh '
    + 'Claude call for output that comes back identical');
});

/* ── the panel is actually mounted ────────────────────────────────────────── */

test('⚠⚠ the summary is MOUNTED and KICKED by the real view function', () => {
  const src = slice('function renderTeamObjectionsView', '\n  }');
  assert.ok(src.indexOf('teamObjSummaryHtml()') !== -1, 'the panel must be in the markup');
  assert.ok(src.indexOf('loadTeamObjSummary()') !== -1, 'and something must fetch it');
  assert.ok(/state\.teamObjSummary === null/.test(src),
    'the lazy kick must test the exact sentinel the state declares, or it never fires');

  // declared with that sentinel — an undeclared key is `undefined`, the kick
  // never fires, and the panel spins forever (reads as "slow", not "broken").
  assert.ok(/teamObjSummary:\s*null/.test(LIVE), 'teamObjSummary must be declared as null');

  // ordering: grid → summary → moments. The claim sits between the numbers it
  // explains and the evidence it rests on.
  const grid = src.indexOf('teamObjGridHtml()');
  const summary = src.indexOf('teamObjSummaryHtml()');
  const feed = src.indexOf('teamObjFeedHtml()');
  assert.ok(grid > -1 && summary > -1 && feed > -1, 'all three anchors must be present before comparing');
  assert.ok(grid < summary && summary < feed, 'grid → summary → moments');
});

/* ── the four states must not converge on screen ──────────────────────────── */

function renderCloser(c) {
  const src = slice('function objSummaryCloserHtml', '\n  }');
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const OBJ_DRILL_LABELS = { fear: 'Fear', logistical: 'Logistical', timing: 'Timing', partner: 'Partner / spouse', uncategorized: 'Uncategorised' };
  const OBJ_SUMMARY_STATE_TEXT = new Function(
    slice('var OBJ_SUMMARY_STATE_TEXT', '\n  };') + '; return OBJ_SUMMARY_STATE_TEXT;')();
  const fn = new Function('escapeHtml', 'OBJ_DRILL_LABELS', 'OBJ_SUMMARY_STATE_TEXT', 'clipLabelFor',
    src + '; return objSummaryCloserHtml;')(escapeHtml, OBJ_DRILL_LABELS, OBJ_SUMMARY_STATE_TEXT, () => 'Clip');
  return fn(c);
}

test('⚠⚠ "not enough data" and "nothing stands out" DO NOT RENDER THE SAME', () => {
  const noVolume = renderCloser({ name: 'Ava', state: 'no_volume' });
  const thin = renderCloser({ name: 'Ben', state: 'thin_types' });
  const even = renderCloser({ name: 'Cara', state: 'even_performance' });

  const texts = [noVolume, thin, even].map((h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.strictEqual(new Set(texts).size, 3, 'three states must produce three sentences:\n' + texts.join('\n'));

  // ⚠ A DATA PROBLEM MUST NEVER READ AS GOOD NEWS.
  assert.ok(/too few objections/i.test(texts[0]), 'no_volume states a shortage: ' + texts[0]);
  assert.ok(/spread across too many types/i.test(texts[1]), 'thin_types states a spread: ' + texts[1]);
  assert.ok(/even across types/i.test(texts[2]), 'even_performance states a RESULT: ' + texts[2]);
  [texts[0], texts[1]].forEach((t) => {
    assert.ok(!/even across types/i.test(t), 'a data shortage must not borrow the good-news wording: ' + t);
  });
});

test('⚠ only a rate_gap card carries a WHY and evidence', () => {
  const gap = renderCloser({
    name: 'Josh', state: 'rate_gap',
    focus: { category: 'timing', total: 55, handled: 4 },
    why: 'He accepts the first reason given.',
    what_to_do: 'Isolate before answering.',
    evidence: [{ quote: 'maybe later', closer_response: 'totally understand', position_pct: 88, clip_url: 'https://f/1?t=9', source: 'fathom' }],
  });
  assert.ok(gap.indexOf('He accepts the first reason given.') !== -1);
  assert.ok(gap.indexOf('88% through the call') !== -1, 'position is what makes the mechanism checkable');
  assert.ok(gap.indexOf('▶ Clip') !== -1, 'evidence keeps its provider-aware clip');

  const quiet = renderCloser({ name: 'Ava', state: 'no_volume', why: 'should not render', evidence: [] });
  assert.strictEqual(quiet.indexOf('should not render'), -1,
    'a non-rate_gap state must never show generated prose — the lib nulls it, and the '
    + 'renderer must not resurrect it either');
});

test('⚠⚠ ONE CLOSER IS NAMED, NEVER CALLED "THE TEAM"', () => {
  const one = renderCloser({
    name: 'Josh', state: 'rate_gap', focus: { category: 'timing', total: 55, handled: 4 },
    why: 'x', what_to_do: 'y', evidence: [],
  });
  assert.ok(one.indexOf('Josh') !== -1, 'the closer is named');
  const text = one.replace(/<[^>]*>/g, ' ');
  assert.ok(!/\bclosers are\b/i.test(text), 'never a collective claim');
  assert.ok(!/\bthe team\b/i.test(text), 'a board of one is a person, not a team');
});

/* ── the waiting state is honest in BOTH directions ───────────────────────── */

test('⚠ the long-wait line is TIME-GATED, not always on', () => {
  const src = slice('function teamObjSummaryHtml', '\n  }');
  assert.ok(src.indexOf('teamObjSummaryWaitLong') !== -1,
    'the "this will take a minute" copy must be behind the flag — always-on would be a '
    + 'lie on a sub-second cached load and would train people to ignore it');
  const loader = slice('async function loadTeamObjSummary', '\n  }');
  assert.ok(loader.indexOf('PERF_LONG_WAIT_MS') !== -1, 'and it reuses the existing threshold');
  assert.ok(/if \(!state\.teamObjSummaryLoading\) return;/.test(loader),
    'the timer must re-check it is still waiting — a fired timer after a fast load '
    + 'would flip the copy on a request that already came back');
});
