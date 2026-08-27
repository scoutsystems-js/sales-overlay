/**
 * THE MANAGER PIVOT (Josh's note, 2026-08-18).
 *
 * Selecting a rep from a Team card opened their coaching view, and clicking
 * "Coaching Dashboard" afterwards KEPT showing that rep.
 *
 * ⚠ THE PIVOT LIVES IN THE QUERY STRING (?user=<id>), NOT THE HASH. That is why
 * it was sticky in THREE ways rather than one:
 *   1. nav clicks change only the hash — the param rides along untouched
 *   2. browser back changes only the hash — same
 *   3. a refresh RE-READS the param at boot and restores the pivot
 * A fix that only handled the nav click would have left two ways to get stuck.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.split('\n')
  .filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function fn(name) {
  const at = LIVE.indexOf('function ' + name);
  assert.ok(at !== -1, name + ' must exist');
  /* ⚠ THE END ANCHOR MISSED `async function`. It looked only for
     `\n  function `, so setUser's slice ran straight past `async function
     reloadAll` and swallowed whatever followed — it tripped on growth in a
     completely unrelated function. Match both forms so the slice covers the
     function it names. */
  const nexts = [LIVE.indexOf('\n  function ', at + 10), LIVE.indexOf('\n  async function ', at + 10)]
    .filter((i) => i !== -1);
  const end = nexts.length ? Math.min.apply(null, nexts) : -1;
  const src = LIVE.slice(at, end === -1 ? at + 900 : end);
  assert.ok(src.length > 20 && src.length < 2000, name + ' slice: ' + src.length);
  return src;
}

test('the nav "Coaching Dashboard" goes to the MANAGER\'S OWN board', () => {
  assert.ok(/id="navOverview" onclick="goOwnCoaching\(\); return false;"/.test(LIVE),
    'the nav link must clear the pivot, not just switch view');
  assert.ok(!/id="navOverview" onclick="setView\('overview'\)/.test(LIVE),
    'the old handler kept the pivot — that was the bug');
});

test('clearing is ONE implementation, not a second copy of setUser', () => {
  const src = fn('clearPivot');
  assert.ok(/setUser\(state\.me\.user_id\)/.test(src),
    'clearPivot must delegate to setUser — it already drops the ?user param, '
    + 'restores the id and clears the per-user caches. A second implementation '
    + 'is a shared carrier waiting to drift.');
});

test('⚠ the fix reaches the QUERY STRING, not only the view', () => {
  // setUser is what actually removes ?user=; if clearing stopped calling it, a
  // refresh would restore the pivot and the bug would be half-fixed invisibly.
  const src = fn('setUser');
  assert.ok(/url\.searchParams\.delete\('user'\)/.test(src),
    'the param must be deleted, or the pivot survives a refresh');
  assert.ok(/history\.replaceState/.test(src));
});

test('Back to Teams clears the pivot AND lands on Team', () => {
  const src = fn('backToTeams');
  assert.ok(/clearPivot\(\)/.test(src), 'must clear');
  assert.ok(/setView\('team'\)/.test(src), 'must navigate to Team');
});

test('the button only exists while pivoted, and sits ABOVE the name', () => {
  // Rendering it on a manager's own board would be noise pointing nowhere.
  assert.ok(/pivoted\(\)\s*\?\s*'<button class="back-to-teams"/.test(LIVE),
    'the coaching header must gate the button on being pivoted');
  assert.ok(/'<div>' \+ backToTeam \+ '<h1>'/.test(LIVE),
    'the button must precede the heading, not follow it');
});

test('it reaches the Calls view too — a separate header, the same trap', () => {
  assert.ok(/'<div>' \+ backToTeamCalls \+ '<h1>Call Library'/.test(LIVE),
    'Calls builds its own header; a manager pivoted there is stuck the same way');
});

test('pivoted() compares against the signed-in user, never a truthiness check', () => {
  const src = fn('pivoted');
  assert.ok(/state\.viewingUserId !== state\.me\.user_id/.test(src),
    'viewingUserId is set to the OWN id when not pivoted — it is never null after '
    + 'boot, so a truthiness test would report "pivoted" always');
});

test('the button is GREEN, per Josh, and Title Case per the standing rule', () => {
  const at = LIVE.indexOf('.back-to-teams {');
  assert.ok(at !== -1, 'the button must be styled');
  const css = LIVE.slice(at, LIVE.indexOf('}', at));
  assert.ok(/var\(--accent\)/.test(css), 'green comes from the accent variable, not a literal');
  assert.ok(/Back to Teams</.test(LIVE), 'Title Case with the connective lowercase');
});
