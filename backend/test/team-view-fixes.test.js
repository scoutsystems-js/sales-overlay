/**
 * Four team-view fixes (b, c, d, g), 2026-08-27.
 *
 * ⚠⚠ (b) AND (d) WERE ONE FAULT REPORTED TWICE. The Per-Closer grid rows carry
 * `.team-detail-row`, which has `cursor: pointer` and an accent hover — so they
 * INHERITED the clickable look from the score list without the behaviour. A row
 * that invites a click and does nothing is worse than one that never invited it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
function fn(name, min, max) {
  const at = LIVE.indexOf(name);
  assert.ok(at !== -1, 'stale anchor: ' + name);
  const out = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(out.length > (min || 40) && out.length < (max || 3000), name + ' slice: ' + out.length);
  return out;
}

test('⚠⚠ (b)+(d) THE PER-CLOSER GRID ROWS ARE CLICKABLE — they already LOOKED it', () => {
  assert.ok(/obj-grid-row" onclick="openCloserObjections/.test(LIVE),
    'they share .team-detail-row, so the affordance was inherited without the behaviour');
  // The shared class is what created the false affordance — assert it still
  // carries the pointer, so the reason this mattered stays visible.
  assert.ok(/\.team-detail-row \{[^}]*cursor: pointer/.test(HTML));
});

test('⚠ IT REUSES setUser — there must not be a second pivot door', () => {
  const src = fn('function openCloserObjections');
  assert.ok(/setUser\(/.test(src),
    'setUser already resets every rep-scoped lane; a parallel pivot is how one gets missed');
  assert.ok(/setView\('objections-intel'\)/.test(src), 'and lands on their objections');
  assert.ok(/if \(!userId\) return/.test(src), 'a row with no id must not navigate nowhere');
});

test('⚠ (g) THE OBJECTION HANDLING BOX IS GONE FROM THE DATE-PICKER ROW', () => {
  const src = fn('function objectionsDrillBtnHtml');
  assert.ok(!/<button/.test(src), 'Justin: it makes no sense beside a date filter');
  // ⚠ AND THE DESTINATION IS NOT ORPHANED — removing the only way in has cost a
  // capability here twice before.
  assert.ok(/openTeamObjections\(\)/.test(LIVE), 'the drilldown must still be reachable');
});

test('⚠⚠ (c) THE TEAM PICK IS PERSISTED — it forgot because it was never STORED', () => {
  // Not a reset bug: teamSelected lived only in module state, so a refresh
  // rebooted it to null, which means "default team".
  const src = fn('function pickTeam');
  assert.ok(/localStorage\.setItem\(TEAM_PICK_KEY/.test(src), 'a pick must be written down');
  assert.ok(/localStorage\.removeItem\(TEAM_PICK_KEY/.test(src), 'and the default must clear it');
  assert.ok(/try \{/.test(src), 'storage can throw — a blocked browser must not lose the picker');
});

test('⚠⚠ A STORED TEAM IS VALIDATED AGAINST WHAT THEY MAY ACTUALLY PICK', () => {
  const src = fn('function restoreTeamPick', 200, 2000);
  assert.ok(/ctx && ctx\.teams/.test(src),
    'a stale key would give an empty board with nothing saying why');
  assert.ok(/removeItem\(TEAM_PICK_KEY\)/.test(src), 'and an invalid one is discarded, not retried forever');
  assert.ok(/state\.teamSelected !== null\) return/.test(src),
    'an explicit pick this session must outrank the stored one');
});

test('⚠ IT IS RESTORED ONLY AFTER /team/context ARRIVES', () => {
  // That response is the only thing that says which teams are pickable, so
  // restoring earlier would skip validation or race the fetch that enables it.
  const at = LIVE.indexOf("which === 'context'");
  assert.ok(at !== -1, 'the restore must hang off the context lane');
  const src = LIVE.slice(at, at + 400);
  assert.ok(/restoreTeamPick\(state\.teamContext\)/.test(src));
  /* ⚠ CONVERTED 2026-08-29: the call now STATES ITS REASON. It used to be a
     bare resetTeamData(), which is exactly how this path diverged from pickTeam
     and left the gauges on the previous team. */
  assert.ok(/resetTeamData\('team'\); renderTeamSurface\(\)/.test(src),
    'a restored pick must behave exactly like a chosen one — same two calls pickTeam makes');
});
