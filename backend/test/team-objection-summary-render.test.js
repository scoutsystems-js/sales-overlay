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
    function scopeSrc(){ var a=LIVE.indexOf("var TEAM_LANE_SCOPE"); return LIVE.slice(a, LIVE.indexOf("};", a)); }
const src = slice('function resetTeamData', '\n  }');
  ['teamObjections', 'teamObjSummary'].forEach((k) => {
    /* ⚠ CONVERTED 2026-08-29: cleared via TEAM_LANE_SCOPE, not a literal null. */
    assert.ok(new RegExp(k + ":\\s*'both'").test(scopeSrc()) || new RegExp('state\\.' + k + '\\s*=\\s*null').test(src),
      k + ' must be reset when the team or range changes, or a stale range renders as current');
  });

  // and the picker must genuinely route through it, or the test above is moot
  const picker = slice('function ensureTeamPicker', '\n  }');
  /* ⚠ CONVERTED 2026-08-29: the picker now passes its REASON — resetTeamData('range'),
     because the date picker is a RANGE change and the fixed-window gauges must
     survive it. The property this guards is unchanged (the picker genuinely
     routes through the reset); only the literal moved. */
  assert.ok(/resetTeamData\('range'\)/.test(picker),
    'the picker must call resetTeamData WITH ITS REASON — otherwise clearing lanes there proves nothing');
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
  /* Fixture, not product: the card now asks whether the viewer may fine-tune and
     which moments are already noted (2026-09-02). A real page has these. */
  const canMarkStandard = () => false;
  const state = { notedHighlightIds: {} };
  void canMarkStandard; void state;
  const src = slice('function objSummaryCloserHtml', '\n  }');
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const OBJ_DRILL_LABELS = { fear: 'Fear', logistical: 'Logistical', timing: 'Timing', partner: 'Partner / spouse', uncategorized: 'Uncategorised' };
  // the copy map now calls objTypeLabel, so the slice must cover the helper too
  const stateSrc = slice('function objTypeLabel', '\n  };');
  assert.ok(stateSrc.length > 600, 'state-text slice must cover the helper AND the map: ' + stateSrc.length);
  const OBJ_SUMMARY_STATE_TEXT = new Function('OBJ_DRILL_LABELS', 'objectionLabel',
    stateSrc + '; return OBJ_SUMMARY_STATE_TEXT;')(OBJ_DRILL_LABELS, (c) => c);
  const fn = new Function('escapeHtml', 'OBJ_DRILL_LABELS', 'OBJ_SUMMARY_STATE_TEXT', 'clipLabelFor', 'canMarkStandard', 'state',
    src + '; return objSummaryCloserHtml;')(escapeHtml, OBJ_DRILL_LABELS, OBJ_SUMMARY_STATE_TEXT, () => 'Clip', canMarkStandard, state);
  return fn(c);
}

test('⚠⚠ "not enough data" and "nothing stands out" DO NOT RENDER THE SAME', () => {
  // ⚠ CONVERTED, NOT REPLACED. The SUBJECT — four states must not converge, and a
  // data problem must never read as good news — is unchanged. The VEHICLE changed:
  // the sentences no longer cite our comparison bar, so the old phrase assertions
  // went with the copy they were pinning.
  const noVolume = renderCloser({ name: 'Ava', state: 'no_volume', total: 3,
    top: { category: 'fear', total: 2, handled: 1, rate_pct: 50 } });
  const thin = renderCloser({ name: 'Ben', state: 'thin_types', total: 9,
    top: { category: 'timing', total: 4, handled: 1, rate_pct: 25 } });
  /* ⚠ REAL COUNTS: even_performance requires volume by definition, so a 0-of-0
     fixture tests a state that cannot occur. And the wording moved from "running
     level" to "even across types" when level-at-ZERO stopped being reported as a
     finding — the SUBJECT of this test (a result, not a shortage) is unchanged. */
  const even = renderCloser({ name: 'Cara', state: 'even_performance', total: 40, handled: 16,
    ranking: [{ category: 'partner', rate_pct: 30, baseline_pct: 33 }] });

  const texts = [noVolume, thin, even].map((h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.strictEqual(new Set(texts).size, 3, 'three states must produce three sentences:\n' + texts.join('\n'));

  // ⚠⚠ JUSTIN'S RULING: EVEN ONE OBJECTION IS DATA. Each quiet state must NAME the
  // type and the rate — a sentence a reader can check against the grid above.
  assert.ok(/Fear/.test(texts[0]) && /1 of 2/.test(texts[0]), 'no_volume names type + rate: ' + texts[0]);
  assert.ok(/Timing/.test(texts[1]) && /1 of 4/.test(texts[1]), 'thin_types names type + rate: ' + texts[1]);
  assert.ok(/Partner/.test(texts[2]) && /30%/.test(texts[2]), 'even_performance names its lowest type: ' + texts[2]);

  // ⚠ A DATA PROBLEM MUST NEVER READ AS GOOD NEWS — the shortage states say so.
  assert.ok(/small|thin/i.test(texts[0]), 'no_volume flags the sample size: ' + texts[0]);
  assert.ok(/small|thin/i.test(texts[1]), 'thin_types flags the sample size: ' + texts[1]);
  assert.ok(/even across types/i.test(texts[2]), 'even_performance states a RESULT: ' + texts[2]);
  [texts[0], texts[1]].forEach((t) => {
    assert.ok(!/even across types/i.test(t), 'a data shortage must not borrow the good-news wording: ' + t);
  });
});

test('⚠⚠ THE QUIET SENTENCES ARE ABOUT THE CLOSER, NOT ABOUT OUR BAR', () => {
  // The defect: three closers in a row rendered the identical sentence with only
  // the name swapped, because the copy described the THRESHOLD. That is a fact
  // about our comparison bar, not about Godwin.
  const a = renderCloser({ name: 'Godwin', state: 'even_performance',
    ranking: [{ category: 'fear', rate_pct: 20, baseline_pct: 24 }] });
  const b = renderCloser({ name: 'Josh N', state: 'even_performance',
    ranking: [{ category: 'timing', rate_pct: 40, baseline_pct: 43 }] });
  const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const ta = strip(a), tb = strip(b);
  assert.notStrictEqual(ta.replace('Godwin', 'X'), tb.replace('Josh N', 'X'),
    'two closers with different data must not render the same sentence:\n' + ta + '\n' + tb);

  // ⚠ CUSTOMER-LANGUAGE RULE: no thresholds, no mechanism, nothing internal.
  [ta, tb].forEach((t) => {
    assert.ok(!/points below/i.test(t), 'no threshold in customer copy: ' + t);
    assert.ok(!/their own average|own average/i.test(t), 'no mechanism in customer copy: ' + t);
    assert.ok(!/\brank\b|\bcompare\b|volume/i.test(t), 'no internal vocabulary: ' + t);
  });
});

test('⚠ a GENUINELY empty range is the only place an empty state is allowed', () => {
  // Reserved for total === 0 — where the server sends no `top` because there is
  // no type to name. Everything else names a type, however small.
  const none = renderCloser({ name: 'Dre', state: 'no_volume', total: 0, top: null });
  const t = none.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(/no objections/i.test(t), 'zero objections says so plainly: ' + t);
  assert.ok(!/\d+ of \d+/.test(t), 'nothing to name means no counts invented: ' + t);
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
