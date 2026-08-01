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
  const m = src.match(/\.select\('timestamp_seconds[^']*'\)/);
  assert.ok(m, 'highlights select on timestamp_seconds not found in routes/fathom.js');
  const line = m[0];
  assert.ok(/\bsection\b/.test(line), 'highlights select must include `section` (else the breakdown always falls back to notes)');
  assert.ok(/\bresolution\b/.test(line), 'highlights select must include `resolution` (else handled objections misgroup)');
});
