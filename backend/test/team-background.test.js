/**
 * TEAM-PAGE RASTER BACKGROUND (2026-08-20).
 * A raster on ONE view; the generated mesh stays everywhere else.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'web');
const PAGE = fs.readFileSync(path.join(WEB, 'dashboard.html'), 'utf8');
// ⚠ strip comments — this file archives removed code in place AND explains the
// rule in prose, so a raw scan reads the documentation as the declaration.
const LIVE = PAGE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const teamRules = [...LIVE.matchAll(/body\[data-view="team"\]::before\s*\{([^}]*)\}/g)];

test('⚠⚠ EXACTLY ONE rule sets a background-image for the team layer', () => {
  /* The cardinality assertion, and it is the point of the whole approach.
     body[data-view] and body[data-view="team"] have IDENTICAL specificity
     (0,1,1), so order alone decides. An earlier attempt added a THIRD rule and
     relied on it landing last; the per-view mesh rule silently overrode its
     background-position and the raster painted at the wrong crop. Extending the
     rule that already exists is what makes "exactly one" true rather than
     "mine happens to be later". */
  const painting = teamRules.filter((r) => /background-image/.test(r[1]));
  assert.strictEqual(painting.length, 1,
    'expected exactly one team rule setting background-image, got ' + painting.length);
  assert.strictEqual(teamRules.length, 1,
    'and exactly one team rule overall — a second would decide by position again');
});

test('the asset ships and is nowhere near the 9 MB source', () => {
  const p = path.join(WEB, 'team-background.webp');
  assert.ok(fs.existsSync(p), 'asset missing');
  const kb = fs.statSync(p).size / 1024;
  assert.ok(kb < 500, 'must stay well under 500 KB; got ' + Math.round(kb) + ' KB');
  // and the superseded JPEG must not come back
  assert.ok(!fs.existsSync(path.join(WEB, 'team-background.jpg')),
    'the orphaned JPEG from the superseded image must stay deleted');
});

test('⚠⚠ background-size is COVER, not the base rule\'s 200% — a decision, not an inheritance', () => {
  const r = teamRules[0][1];
  assert.ok(/background-size:\s*cover/.test(r),
    '200% 200% exists because the mesh is one field windowed per view; inheriting '
    + 'it here would zoom into a quarter of a photograph. cover DOWNSCALES this '
    + '3200x2000 asset at every supported width (0.450 at 1440, 0.600 at 1920).');
  assert.ok(/background-position:\s*center/.test(r),
    'the bright clusters sit at the left/right edges and .page is a centred '
    + 'opaque 1200px column — centring keeps them in the visible gutters');
});

test('⚠ opacity inside the band DERIVED FROM THIS ASSET at the BINDING width', () => {
  /* Measured on the shipping WebP inside the real header text box, vs #ededed:
       1440  brightest 194.0  -> 0.50 = 4.70 ok, 0.60 = 3.61 FAIL   <- binding
       1920  brightest  12.9  -> 0.60 = 16.71 ok
     The crop decides which region lands under the text, so the worst case is a
     REGION and it is not the same one at both widths. */
  const op = parseFloat((teamRules[0][1].match(/opacity:\s*([\d.]+)/) || [])[1]);
  assert.ok(op > 0 && op <= 0.50,
    'ceiling is 0.50 at 1440 (4.70:1); above it #ededed drops below AA. got ' + op);
  assert.ok(op >= 0.25, 'below ~0.25 the image stops reading at all. got ' + op);
});
