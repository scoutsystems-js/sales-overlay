const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠ TWO QUESTIONS, AND A FIX MUST NOT SILENTLY ANSWER BOTH.
   (1) Should a deactivated person's NUMBERS still count? Justin ruled YES —
       "deactivate leaves the numbers".
   (2) Should they still be drawn as a ROW on the board? No — and a row reading
       "Deleted user (49711e7d)" on a live team board least of all.
   This change answers only (2). The scope (`repIds`) is untouched, so every
   aggregate is byte-identical; the server marks each rep and the board skips
   drawing the inactive ones.
   ⚠ Filtering them out of `repIds` instead would silently rewrite the team's
   history — the opposite of the ruling. */

const ROOT = path.join(__dirname, '..');
function live(p) {
  const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
  return src.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

test('⚠⚠ the SCOPE is untouched — inactive users still count', () => {
  const src = live('lib/team-analytics.js');
  // repIds must never be filtered by `active` anywhere in the aggregation
  assert.ok(!/repIds\s*=\s*repIds\.filter/.test(src), 'the rep scope must not be narrowed');
  assert.ok(!/\.eq\('active', true\)/.test(src), 'no aggregate may filter on active');
  /* ⚠ THIS ASSERTION WAS TOO WIDE ON ITS FIRST DRAFT and matched
     `active_reps: per_rep.filter(r => r.calls_analyzed > 0)` — a PRE-EXISTING
     field counting reps who took calls, nothing to do with the `active` column.
     The claim is "the aggregation never drops a rep for being deactivated", so
     the check names that: no filter keyed on the profile's `active` value. */
  assert.ok(!/filter\([^)]*\.active\b/.test(src.replace(/\n/g, ' ')),
    'team-analytics must MARK reps inactive, never FILTER them out of the aggregate');
  assert.ok(/active_reps: per_rep\.filter/.test(src),
    'sanity: the unrelated active_reps field still exists, so the check above is not passing by accident');
});

test('the per-rep payload carries `active` so the client can decide', () => {
  const src = live('lib/team-analytics.js');
  assert.ok(/select\('user_id, first_name, last_name, active'\)/.test(src),
    'the profile lookup must fetch it');
  assert.ok(/active: \(profileMap\[id\] && profileMap\[id\]\.active\) !== false/.test(src),
    'and it must default to ACTIVE when unknown — a missing profile must not hide a real rep');
});

test('⚠⚠ the board skips drawing inactive rows, in BOTH lists', () => {
  const src = live('web/dashboard.html');
  assert.ok(/function visibleReps\(list\)/.test(src), 'one predicate, not two');
  const uses = (src.match(/visibleReps\(/g) || []).length;
  assert.ok(uses >= 3, 'expected the definition plus both call sites, found ' + uses);
  assert.ok(/visibleReps\(reps\)\.map\(repCardHtml\)/.test(src), 'the rep cards must use it');
  /* Converted 2026-09-02: the three score lists retired with the trading-card
     rep cards; the second list that draws people is now the widget picker's
     closer list. Same property — every list of people skips inactive rows. */
  assert.ok(/visibleReps\(ov\.per_rep\)\.slice\(\)/.test(src), 'the widget picker\'s closer list must use it');
});

test('⚠ unknown/absent `active` renders — the default must not hide real people', () => {
  // A rep whose profile row failed to load must still appear. Hiding on
  // "not explicitly true" would make a lookup failure look like a deactivation.
  const src = live('web/dashboard.html');
  const at = src.indexOf('function visibleReps');
  const fn = src.slice(at, at + 220);
  assert.ok(/r\.active !== false/.test(fn), 'must hide only an EXPLICIT false');
  assert.ok(!/r\.active === true/.test(fn), 'requiring true would hide anyone whose profile is missing');
});
