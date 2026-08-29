/**
 * "Discovery is your weakest section — here are your best discovery moments."
 * The surfacing KB Part 2 sub-stage 2c(iii) deferred until it had a home.
 *
 * ⚠⚠ IT WAS BLOCKED ON A PRECONDITION AND THE PRECONDITION WAS CHECKED, TWICE.
 * Harvested moments were 24% unembedded; surfacing built on similarity search
 * would have hidden a quarter of exactly what it exists to find, silently. The
 * backfill closed that (2,395 of 2,395 embedded) — and this feature selects by
 * SECTION AND OWNER anyway, so it cannot be affected by an unembedded row at
 * all. That is the safer design and it is deliberate.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { selectLibraryMoments, LIBRARY_CAP } = require('../lib/section-library');

function row(over) {
  return Object.assign({
    source_fathom_call_id: 'call-1',
    source_section: 'discovery',
    created_at: '2026-08-20T00:00:00Z',
    metadata: Object.assign({
      speaker: 'CLOSER', speaker_verified: true,
      quote: 'a real line the closer said', observation: 'it landed',
      type: 'strong_moment', timestamp_seconds: 120,
    }, (over || {}).metadata),
  }, over && over.top);
}

test('a proven closer line is kept, with what the panel needs to render it', () => {
  const out = selectLibraryMoments([row()]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].quote, 'a real line the closer said');
  assert.strictEqual(out[0].observation, 'it landed');
  assert.strictEqual(out[0].timestamp_seconds, 120);
  assert.strictEqual(out[0].fathom_call_id, 'call-1');
});

test('⚠⚠ a PROSPECT-spoken moment is NEVER shown as the rep\'s own', () => {
  /* Harvested moments legitimately include prospect lines — objections and
     buying signals — because the extractor flags on merit. This panel says
     "here is what YOU said that worked", so a prospect quote here would file
     their words as the rep's winning material. 6b had to REPAIR exactly that. */
  const out = selectLibraryMoments([
    row({ metadata: { speaker: 'PROSPECT', quote: 'This wasn\'t in the budget.' } }),
    row(),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].quote, 'a real line the closer said');
});

test('⚠ an UNPROVEN speaker is excluded — absent is not a positive verdict', () => {
  const cases = [undefined, null, false, 'false', 0, ''];
  cases.forEach(v => {
    const out = selectLibraryMoments([row({ metadata: { speaker_verified: v } })]);
    assert.strictEqual(out.length, 0, 'speaker_verified=' + JSON.stringify(v) + ' must not qualify');
  });
  // the string 'true' is accepted — jsonb round-trips booleans as strings
  assert.strictEqual(selectLibraryMoments([row({ metadata: { speaker_verified: 'true' } })]).length, 1);
});

test('a blank quote is dropped — there is nothing to show', () => {
  ['', '   ', null, undefined].forEach(q => {
    assert.strictEqual(selectLibraryMoments([row({ metadata: { quote: q } })]).length, 0);
  });
});

test('newest first, and capped', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push(row({ top: { created_at: '2026-08-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z' },
                    metadata: { quote: 'line ' + i } }));
  }
  const out = selectLibraryMoments(rows);
  assert.strictEqual(out.length, LIBRARY_CAP, 'a coaching aid, not a dump');
  assert.strictEqual(out[0].quote, 'line 19', 'newest must lead');
  /* ⚠ Without an explicit sort the panel drifts toward insertion order, which
     is the OLDEST material — the opposite of useful. */
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].created_at >= out[i].created_at, 'ordering must be monotonic');
  }
});

test('total on junk — a coaching panel must never throw', () => {
  [null, undefined, 'nope', 42, {}].forEach(v => {
    assert.doesNotThrow(() => selectLibraryMoments(v));
    assert.deepStrictEqual(selectLibraryMoments(v), []);
  });
  assert.deepStrictEqual(selectLibraryMoments([null, {}, { metadata: null }]), []);
});

/* ── wiring ─────────────────────────────────────────────────────────────── */

function code(p) {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
    .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('the lane is scoped to the SUBJECT, and selects by section — not by similarity', () => {
  const src = code('routes/me.js');
  assert.ok(/selectLibraryMoments\(visible\)/.test(src),
    'it must use the shared selection rule, over the VISIBILITY-filtered rows');
  /* ⚠ CONVERTED 2026-08-29. This used to pin `.eq('uploaded_by', userId)`, and
     that filter is exactly what made the manager Add-to-KB path invisible: a
     promoted moment carries uploaded_by = THE MANAGER, so a rep-scoped filter
     could never return one. The SUBJECT survives — the lane is still scoped to
     what this user may see, and still selects by SECTION rather than by
     similarity — but the rule is now the SHARED predicate. */
  assert.ok(/kbReadRowVisible\(r, callerScope\)/.test(src),
    'visibility must come from the shared predicate, not a hand-rolled filter');
  assert.ok(/\.eq\('source_section', section\)/.test(src), 'still selected by section');
  assert.ok(/uploaded_by\.eq\.' \+ userId/.test(src), 'the candidate set still includes their own');
  assert.ok(/team_owner_id\.eq\.' \+ adminId/.test(src), 'and their team\'s');
  /* ⚠ NO similarity search anywhere in this lane. A section filter cannot
     silently omit an unembedded row; a similarity query can. */
  const s0 = src.indexOf('out.library = []');
  assert.ok(!/match_knowledge|\.rpc\(/.test(src.slice(s0, src.indexOf('return out;', s0))),
    'the library lane must not reach for similarity search');
});

test('a library failure cannot take down the drilldown', () => {
  const src = code('routes/me.js');
  /* ⚠ fromIndex, always. `return out;` occurs EARLIER in this file, so without
     it the slice runs backwards and yields '' — which would make every
     assertion below pass vacuously. The length check is what caught it. */
  const start = src.indexOf('out.library = []');
  const lane = src.slice(start, src.indexOf('return out;', start));
  assert.ok(lane.length > 300, 'lane slice too short: ' + lane.length);
  assert.ok(/catch \(e\) \{ out\.library = \[\]; \}/.test(lane),
    'it must degrade to an empty library, never throw');
});

test('the admin pivot gets the REP\'s library, by construction', () => {
  /* The mirror passes targetUserId into the same function, so the scoping is
     inherited rather than reimplemented — no second place to get it wrong. */
  assert.ok(/_computeSectionBreakdown\(admin, targetUserId, section, from, to\)/.test(code('routes/admin.js')));
});

test('the panel renders, states its SCOPE, and explains an empty state', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const at = html.indexOf('function sectionLibraryHtml');
  assert.ok(at > 0, 'the panel builder is missing');
  const fn = html.slice(at, html.indexOf('\n  }', at));
  assert.ok(fn.length > 400, 'slice must cover the builder: ' + fn.length);

  /* ⚠ EVERY OTHER PANEL ON THIS PAGE IS WINDOWED AND THIS ONE IS NOT. Two
     scopes on one screen reads as a bug unless the scope is on screen. */
  assert.ok(/not affected by the date filter above/.test(fn), 'it must state its scope');
  assert.ok(/Nothing captured yet/.test(fn), 'the empty state must explain where moments come from');
  assert.ok(/clipLabelFor\(m\.source\)/.test(fn), 'the clip label must be provider-aware');
  // and it is actually called
  assert.ok(/\+ groups \+ examples \+ sectionLibraryHtml\(d, label\)/.test(html),
    'the builder must be invoked by renderSectionView');
});
