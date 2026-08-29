const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* ⚠⚠⚠ THE CONTROL AND THE BOARD MUST READ FROM ONE VALUE.
   Justin, 2026-08-29: on Sober Living Riches he hits refresh and the page comes
   back with SCOUT SYSTEMS' name and numbers while the DROPDOWN still reads
   SOBER LIVING RICHES. Silently wrong and confidently labelled.

   MECHANISM: renderTeamView kicks eight lanes in parallel and loadTeam builds
   each URL AT CALL TIME, while teamSelected is still null — so overview asks for
   the DEFAULT team. /team/context (small, fast) returns first, restoreTeamPick
   sets the saved selection and calls resetTeamData(), which nulled the DATA but
   not the *Loading FLAGS. The refetch hit `if (state[c.flag]) return` and never
   ran, and the original default-team response then landed. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = SRC.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('⚠⚠ resetTeamData CLEARS THE IN-FLIGHT FLAGS — nulling the data alone was the bug', () => {
  const at = LIVE.indexOf('function resetTeamData');
  assert.ok(at !== -1);
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(fn.length > 300, 'slice must cover it: ' + fn.length);
  ['teamOverviewLoading', 'teamRepSeriesLoading', 'teamWhyLoading', 'teamObjectionsLoading']
    .forEach((f) => assert.ok(new RegExp(f + ' = false').test(fn),
      f + ' must be cleared, or its lane refuses to refetch'));
});

test('⚠⚠ a STALE response is discarded — clearing the flags alone is not enough', () => {
  // The first request is still in flight and would still resolve LAST,
  // overwriting the correct payload. The epoch is what makes it discardable.
  assert.ok(/var teamEpoch = 0;/.test(LIVE), 'the epoch must exist');
  const at = LIVE.indexOf('function resetTeamData');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(/teamEpoch\+\+/.test(fn), 'the reset must bump it');
  const lt = LIVE.indexOf('async function loadTeam');
  const body = LIVE.slice(lt, lt + 3000);
  assert.ok(/var epoch = teamEpoch;/.test(body), 'each request must record its epoch');
  assert.ok(/epoch !== teamEpoch/.test(body), 'and a stale answer must be dropped');
});

test("⚠ `context` is EXEMPT from the epoch check — it is what triggers the reset", () => {
  // It is not team-scoped: it is the list of teams this person may pick, and
  // dropping it would discard the very response that caused the bump.
  const lt = LIVE.indexOf('async function loadTeam');
  const body = LIVE.slice(lt, lt + 3000);
  assert.ok(/which !== 'context' && epoch !== teamEpoch/.test(body),
    'the exemption must be explicit, not incidental');
});

test('⚠⚠ the TITLE and the DROPDOWN resolve from the SAME value', () => {
  // They used to have two sources: the dropdown read the SELECTION, the title
  // read the DATA payload. Two sources can disagree, and after a refresh they did.
  assert.ok(/function teamLabelForSelection\(\)/.test(LIVE), 'one resolver must exist');
  const at = LIVE.indexOf('function teamLabelForSelection');
  const fn = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(/state\.teamSelected/.test(fn), 'it must key on the SELECTION, like the picker');
  assert.ok(/t\.is_self/.test(fn), 'and fall back to the default team the picker marks');
  // and the header must use it
  const hdr = LIVE.indexOf('var label = teamLabelForSelection()');
  assert.ok(hdr !== -1, 'the header must resolve through it');
});

test('⚠ the label still falls back — a non-owner has no picker to resolve against', () => {
  const hdr = LIVE.indexOf('var label = teamLabelForSelection()');
  const seg = LIVE.slice(hdr, hdr + 300);
  assert.ok(/teamOverview && state\.teamOverview\.team && state\.teamOverview\.team\.label/.test(seg),
    'must fall back to the payload label when there is no team list');
  assert.ok(/'Team'/.test(seg), "and to 'Team' when there is neither");
});
