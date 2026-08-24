// Part 1b regression guard: /fathom/calls/:id must SELECT the highlight columns
// the section breakdown needs — `section` (to bucket by call section) and
// `resolution` (so a handled objection groups as "What worked"). Missing either
// silently degrades every section expansion to the notes-prose fallback, which
// the unit tests can't catch (they feed highlights directly). Caught live once;
// this pins it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');

test('the /calls/:id highlights select includes section and resolution', () => {
  // The highlights query line selecting timestamp_seconds ... must carry both.
  const m = src.match(/\.select\('id, timestamp_seconds[^']*'\)/);
  assert.ok(m, 'highlights select on timestamp_seconds not found in routes/fathom.js');
  const line = m[0];
  assert.ok(/\bsection\b/.test(line), 'highlights select must include `section` (else the breakdown always falls back to notes)');
  assert.ok(/\bresolution\b/.test(line), 'highlights select must include `resolution` (else handled objections misgroup)');
});

test('the /calls/:id highlights select includes id (Part 2b Add-to-KB)', () => {
  // The Add-to-Knowledge-Base button sends IDS ONLY — without `id` the client has
  // nothing to send and every button is inert. Same failure class as the missing
  // `section`/`resolution` above: unit tests feed highlights directly and can't see it.
  const m = src.match(/\.select\('id, timestamp_seconds[^']*'\)/);
  assert.ok(m, 'highlights select must lead with `id` for the Add-to-KB button');
});

/* ── the same defect class, third instance ────────────────────────────────── */

test('⚠⚠ /fathom/status SELECTS sync_window — a column the response reads', () => {
  /* Third time: Part-1b shipped without `section`, 2b without `id`, and this
     block wrote `sync_window` into the response body while the query did not
     ask for it. The component is correct; the thing that FEEDS it is broken, so
     every check aimed at the component passes and the field is silently null. */
  const fs2 = require('fs'), path2 = require('path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
  const i = src.indexOf("'connected_at, last_sync_at, last_sync_status");
  assert.ok(i !== -1, 'stale anchor: the status connection select moved');
  const sel = src.slice(i, src.indexOf(")", i));
  assert.ok(sel.indexOf('sync_window') !== -1,
    'the status route returns sync_window, so it must select it — otherwise the '
    + 'history window selector silently shows the default for everyone');
});
