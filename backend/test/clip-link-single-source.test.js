/**
 * ⚠⚠ EVERY CLIP LINK GOES THROUGH lib/clip-link.js. NOTHING BUILDS ONE INLINE.
 *
 * A clip is a timestamped deep link into the provider's player. Fathom's `?t=`
 * SEEKS; a Zoom share link carries no timestamp and opens at 00:00. So the
 * LABEL is provider-dependent, and a builder that doesn't know the provider
 * cannot label its own button.
 *
 * ⚠ THE FAILURE THIS EXISTS TO PREVENT IS SILENT AND USER-VISIBLE. An inline
 * builder has no `source`, so it hard-codes "Clip" — and on a Zoom call that is
 * a button promising a moment and delivering the start of the recording. It
 * throws nothing, logs nothing, and looks exactly like a working feature.
 *
 * ⚠⚠ THE COUNT WAS WRONG WHEN THIS WAS WRITTEN, WHICH IS THE ARGUMENT FOR A
 * GUARD RATHER THAN A SWEEP. The standing note said "six inline builders in
 * four modules". The real inventory was TEN across SEVEN files — the extra four
 * were missed because they build through a local `clipUrl(rec, ts)` helper or
 * name the variable `rec`, so a grep shaped around `recording_url + '?t='`
 * walked straight past them. An enumeration is only as good as the pattern
 * used to enumerate, and that pattern is the thing least likely to be re-read.
 * (An eleventh match, routes/fathom.js building `recorded_by[]=`, was a FALSE
 * positive — same query-string shape, nothing to do with clips.)
 *
 * Same shape as the repSeriesChart parity guard: assert the PROPERTY the
 * surface must have, not that a particular call was written.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// ⚠ strip comments FIRST — this codebase archives removed code in place and
// explains its rules in prose, so a raw scan reports documentation of the rule
// as a violation of it. Line comments before block comments: a `/*` inside a
// `//` line is a false opener.
const live = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// the signature of hand-rolling a deep link
const INLINE = /indexOf\('\?'\)\s*===\s*-1\s*\?\s*'\?'\s*:\s*'&'/g;

const CLIP_MODULES = [
  'lib/objection-synthesis.js',
  'lib/performance-synthesis.js',
  'lib/section-breakdown.js',
  'lib/session-analytics.js',
  'lib/team-synthesis.js',
  'lib/team-needs-work.js',
  'lib/team-digest.js',
];

test('⚠⚠ NO module builds a clip href inline — lib/clip-link.js is the only one', () => {
  const offenders = [];
  CLIP_MODULES.forEach((f) => {
    const n = (live(read(f)).match(INLINE) || []).length;
    if (n) offenders.push(f + ' (' + n + ')');
  });
  assert.deepStrictEqual(offenders, [],
    'these build a clip href by hand and therefore cannot label it per provider: '
    + offenders.join(', ') + ' — use clipHref() from lib/clip-link.js');
});

test('⚠ every clip-producing module IMPORTS the shared rule', () => {
  CLIP_MODULES.forEach((f) => {
    const src = live(read(f));
    if (!/clip_url/.test(src)) return;          // not a producer
    assert.ok(/require\(['"]\.\/clip-link['"]\)/.test(src),
      f + ' produces clip_url but does not require ./clip-link');
  });
});

/**
 * ⚠ THE SELECT IS THE HALF THAT ACTUALLY BREAKS. Routing through clipHref is
 * cosmetic if `source` never reaches the row — the label would silently fall
 * back to the non-seeking default for FATHOM too, which is the same defect
 * pointed the other way.
 */
test('⚠⚠ every fathom_calls select that powers a clip carries `source`', () => {
  const mustCarrySource = [
    ['lib/objection-synthesis.js', 'recording_url'],
    ['lib/performance-synthesis.js', 'recording_url'],
    ['lib/session-analytics.js', 'recording_url'],
    ['lib/team-synthesis.js', 'recording_url'],   // loadTeamWindow — feeds needs-work + digest too
  ];
  mustCarrySource.forEach(([f, anchor]) => {
    const src = live(read(f));
    const selects = src.match(/\.select\('[^']*'\)/g) || [];
    const clipSelects = selects.filter((s) => s.indexOf(anchor) !== -1);
    assert.ok(clipSelects.length > 0, f + ': stale anchor — no select mentions ' + anchor);
    clipSelects.forEach((s) => {
      assert.ok(/\bsource\b/.test(s),
        f + ': a select carrying recording_url must also carry source, else the '
        + 'clip cannot be labelled per provider — got ' + s);
    });
  });
});

test('⚠ the label is never hard-coded in the page — it comes from the source', () => {
  const page = live(read('web/dashboard.html'));
  const hard = (page.match(/▶ Clip</g) || []).length;
  assert.strictEqual(hard, 0,
    hard + ' hard-coded "▶ Clip" label(s) remain — a Zoom moment would claim to '
    + 'seek. Route them through clipLabelFor(<row>.source).');
  assert.ok(/function clipLabelFor/.test(page), 'the page must keep its mirrored label rule');
});

test('⚠ clip-link degrades exactly as ruled: no URL → no button, Zoom → Open Recording', () => {
  const { clipHref, clipLabel } = require('../lib/clip-link');
  assert.strictEqual(clipHref(null, 12), null, 'no URL → null, so callers render NOTHING');
  assert.strictEqual(clipHref('https://x/y', null), null, 'no timestamp → null');
  assert.strictEqual(clipLabel('fathom'), 'Clip', 'Fathom seeks');
  assert.strictEqual(clipLabel('zoom'), 'Open Recording', 'Zoom opens at 00:00');
  assert.strictEqual(clipLabel(undefined), 'Open Recording',
    'unknown provider gets the cautious label — claiming a seek we cannot '
    + 'deliver is the failure mode; claiming less is merely modest');
  assert.strictEqual(clipHref('https://x/y?a=1', 30), 'https://x/y?a=1&t=30', 'existing query string');
});

/**
 * ⚠⚠ THE PASS-THROUGH GUARD. The select and the builder can both be right and
 * the label still wrong, because several producers hand a clip on through an
 * intermediate object (`ev.clip_url`, `o.clip_url`). If `source` is dropped at
 * any hop it arrives undefined, `clipLabelFor` returns the cautious default,
 * and every FATHOM clip silently reads "Open Recording" — the same defect as
 * an unlabelled Zoom clip, pointed the other way and just as invisible.
 *
 * So: wherever `clip_url:` is written into an object literal, `source:` must be
 * written beside it. Checkable statically, and it catches the hop a sweep misses.
 */
test('⚠⚠ source rides WITH clip_url at every emission — no dropped hops', () => {
  const orphans = [];
  CLIP_MODULES.forEach((f) => {
    const lines = live(read(f)).split('\n');
    lines.forEach((line, i) => {
      if (line.indexOf('clip_url:') === -1) return;
      // ⚠ THE WINDOW IS THE OBJECT LITERAL, NOT THE LINE. `source:` is a
      // sibling key and sits on an adjacent line as often as the same one — a
      // one-line check reports every one of those as an orphan, which is this
      // guard's own scope-vs-claim failure and cost a round to notice.
      const near = lines.slice(Math.max(0, i - 1), i + 4).join(' ');
      if (/\bsource:/.test(near)) return;
      orphans.push(f + ' → ' + line.trim().slice(0, 90));
    });
  });
  assert.deepStrictEqual(orphans, [],
    'clip_url is emitted without source beside it — the label would fall back '
    + 'to "Open Recording" for every provider:\n  ' + orphans.join('\n  '));
});

/**
 * ⚠⚠ THE BUILDER SWEEP MISSED A RENDERER (found 2026-08-22).
 *
 * `b6f6264` routed every place that BUILDS an href through lib/clip-link, and
 * this file guarded exactly that. It did NOT guard the WORD printed on the
 * link — and `objFeedCard` went on emitting a literal "▶ Watch Clip" over a
 * perfectly correct provider-aware clip_url. Six sibling render sites already
 * used the helper, which is what made the seventh invisible: any spot check
 * would have landed on a correct one.
 *
 * ⚠ It could not have RENDERED wrong at the time — there were zero analysed
 * Zoom moments — so looking could never have caught it either. That is the
 * argument for this guard rather than an inspection.
 */
test('⚠⚠ no render site hardcodes a clip label — the WORD comes from the helper too', () => {
  const page = live(read('web/dashboard.html'));

  // ⚠ CUT THE HELPER OUT FIRST. clipLabelFor's own body must contain both
  // words; matching over it is the guard reporting the rule as a violation of
  // itself — the same shape as a checker reading its own documentation.
  const def = page.indexOf('function clipLabelFor');
  assert.ok(def > -1, 'stale anchor: clipLabelFor must be defined in the page');
  const body = page.slice(def, page.indexOf('\n  }', def) + 4);
  assert.ok(body.length > 40 && body.length < 1200, 'helper slice: ' + body.length);
  const outside = page.slice(0, def) + page.slice(def + body.length);

  /* ⚠⚠ MATCH THE WORD, NOT ONE SPELLING OF IT. The guard this replaces looked
     for the exact string "▶ Clip<" and therefore MISSED `objFeedCard` emitting
     "▶ Watch Clip" — the identical defect wearing a different label. A guard
     whose claim is "never hard-coded" and whose scope is one literal will keep
     passing while the thing it names is on screen. */
  ['Watch Clip', 'Open Recording', '▶ Clip'].forEach((lit) => {
    assert.strictEqual(outside.indexOf(lit), -1,
      'a clip label is hardcoded as "' + lit + '" outside clipLabelFor — it must come '
      + 'from clipLabelFor(<row>.source), or a Zoom moment claims a seek it cannot deliver');
  });

  // ⚠ FLOOR, not just an absence check: "no literals" passes perfectly against
  // a page with no clip links at all.
  const uses = (outside.match(/clipLabelFor\(/g) || []).length;
  assert.ok(uses >= 7, 'expected the label helper at every render site; found ' + uses);
});
