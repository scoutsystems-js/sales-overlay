/**
 * EVERY COUNTING SURFACE MUST EXCLUDE A SUPPRESSED DUPLICATE.
 *
 * ⚠⚠ ENUMERATED BY CAPABILITY, NOT BY A LIST OF PANELS. The capability is
 * "excludes a marked call from a count", and the existing expression of it is
 * the `not_a_sales_call` filter. A duplicate is the same kind of row — present,
 * real, and must not be counted — so the two exclusions belong together at
 * every site.
 *
 * ⚠ THE ASSERTION IS PAIRING, NOT PRESENCE. Counting each filter separately
 * would pass while they sat in different queries. Requiring them adjacent means
 * a new counting surface cannot pick up one and forget the other — which is
 * exactly how nine modules have dropped out of lists in this codebase before.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function sources() {
  const out = [];
  ['lib', 'routes'].forEach((dir) => {
    const d = path.join(__dirname, '..', dir);
    fs.readdirSync(d).filter((f) => f.endsWith('.js')).forEach((f) => {
      out.push({ rel: dir + '/' + f, src: fs.readFileSync(path.join(d, f), 'utf8') });
    });
  });
  return out;
}

test('⚠⚠ EVERY not_a_sales_call EXCLUSION IS PAIRED WITH A duplicate_of EXCLUSION', () => {
  const misses = [];
  let pairs = 0;
  sources().forEach(({ rel, src }) => {
    const live = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const re = /\.not\('not_a_sales_call', 'is', true\)([\s\S]{0,120})/g;
    let m;
    while ((m = re.exec(live)) !== null) {
      if (/\.not\('duplicate_of', 'is', null\)/.test(m[1])) pairs++;
      else misses.push(rel);
    }
  });
  assert.deepStrictEqual(misses, [],
    'these surfaces exclude not-a-sales-call but still COUNT cross-provider '
    + 'duplicates, so their figures are inflated: ' + JSON.stringify(misses));
  assert.ok(pairs >= 21,
    'expected at least the 21 known counting surfaces; found ' + pairs
    + '. If this dropped, a surface was removed — confirm that was deliberate.');
});

test('⚠ NON-VACUITY: an unpaired exclusion is caught', () => {
  const broken = "  .eq('user_id', id)\n  .not('not_a_sales_call', 'is', true)\n  .order('call_date');";
  const re = /\.not\('not_a_sales_call', 'is', true\)([\s\S]{0,120})/g;
  const m = re.exec(broken);
  assert.ok(m, 'the matcher must find the exclusion at all');
  assert.ok(!/\.not\('duplicate_of', 'is', null\)/.test(m[1]),
    'and must report an unpaired one as a miss — otherwise the check above is vacuous');
});
