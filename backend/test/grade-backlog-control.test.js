/**
 * ⚠⚠ THE GRADING CONTROL: ONE IMPLEMENTATION, TWO RENDER SITES.
 *
 * The control used to live only in Account -> Connections and Justin could not
 * find it. It is now also on the Calls page, on the line that already says
 * "N not graded yet". The risk introduced by having two sites is that they
 * DIVERGE — so these guards assert there is exactly one option list, one role
 * cap and one cost rule, and that both sites mount the same host.
 *
 * ⚠ The real functions are EXECUTED, not grepped. Grepping for a name proves the
 * code exists; it cannot prove the option list a non-owner is shown omits
 * all-time. Both checks have passed here before while the behaviour was wrong.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

/* ⚠⚠ LINE COMMENTS FIRST, THEN BLOCK COMMENTS. A `/*` inside a `//` line is a
   FALSE OPENER that pairs with the next real terminator and swallows everything
   between — a latent bug that sat in eleven guards in this repo and detonated on
   an ordinary docblock. Do not reorder these two lines. */
function stripComments(src) {
  const noLine = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Slice a function out of the page. fromIndex is not optional — without it the
 *  end marker is found EARLIER in the file and the slice runs backwards to ''. */
function fnSource(name, endMarker, minLen) {
  const at = HTML.indexOf('function ' + name);
  assert.ok(at !== -1, 'stale anchor: function ' + name + ' not found');
  const end = HTML.indexOf(endMarker, at);
  assert.ok(end !== -1, 'stale end marker for ' + name);
  const src = HTML.slice(at, end);
  assert.ok(src.length > minLen, name + ' slice too short (' + src.length + ') — check the markers');
  return src;
}

/** Run the extracted control against a fake state. */
function control(role, over) {
  const src = [
    fnSource('gradeAllTimeAllowed', '\n  function gradeBacklogWorkCount', 80),
    fnSource('gradeBacklogWorkCount', '\n  function gradeCostText', 100),
    fnSource('gradeCostText', '\n  function gradeScopeLabel', 60),
    fnSource('gradeScopeLabel', '\n  function gradeBacklogControlHtml', 60),
    fnSource('gradeBacklogControlHtml', '\n  function paintGradeBacklog', 1200),
  ].join('\n');
  const state = Object.assign({
    me: { role: role, user_id: 'u1' },
    fathomStatus: { connected: true, pending_count: 40, outdated_count: 0 },
    gradeRun: null, gradeConfirm: null, gradeChecking: false,
  }, over || {});
  // gradeScopeOptionsHtml sits above the slice; pull it separately.
  const optSrc = fnSource('gradeScopeOptionsHtml', '\n  function gradeBacklogWorkCount', 100);
  /* ⚠ THE COST CONSTANT IS READ FROM THE PAGE, NOT PINNED HERE. A number copied
     into a test goes stale on exactly the change it exists to police, and then
     reads as the CHANGE being wrong. */
  const costM = /GRADE_COST_PER_CALL = ([0-9.]+)/.exec(HTML);
  assert.ok(costM, 'GRADE_COST_PER_CALL is gone from the page');
  const preamble = 'var GRADE_COST_PER_CALL = ' + costM[1] + ';\n';
  const g = new Function('state', 'escapeHtml',
    preamble + optSrc + '\n' + src + '\n; return gradeBacklogControlHtml();');
  return g(state, (x) => String(x));
}

test('a non-owner is NOT offered all time; an owner is', () => {
  const user = control('user');
  const mgr = control('manager');
  const owner = control('owner');
  assert.ok(!/value="all"/.test(user), 'a plain user must not see the all-time option');
  assert.ok(!/value="all"/.test(mgr), 'a MANAGER must not see it — the trial account is a manager');
  assert.ok(/value="all"/.test(owner), 'an owner must see it');
  // every role still gets the two uncapped windows
  [user, mgr, owner].forEach((h) => {
    assert.ok(/value="7d"/.test(h) && /value="30d"/.test(h), '7d and 30d are available to everyone');
  });
});

test('a capped user is TOLD WHY, not just given fewer options', () => {
  const user = control('user');
  assert.match(user, /limited to admins/i, 'fewer options with no reason reads as broken');
  assert.ok(!/limited to admins/i.test(control('owner')), 'an owner needs no cap note');
});

test('EXACTLY ONE option list — neither render site inlines its own', () => {
  const live = stripComments(HTML);
  const optionTags = (live.match(/<option value="7d">/g) || []).length;
  assert.strictEqual(optionTags, 1,
    'found ' + optionTags + ' window option lists in the render path; there must be one '
    + '(gradeScopeOptionsHtml) or the two sites will come to offer different windows');
});

test('BOTH render sites mount the same host', () => {
  const live = stripComments(HTML);
  const hosts = (live.match(/class="grade-backlog-host"/g) || []).length;
  assert.strictEqual(hosts, 2, 'expected the Calls page and Connections, found ' + hosts);
  // and the Calls one is the guarded one
  const at = live.indexOf('var gradeHost =');
  assert.ok(at !== -1, 'the Calls-page host is gone');
  const slice = live.slice(at, at + 240);
  assert.match(slice, /isSelf\(\)/,
    'the Calls control must be self-only: grading is scoped to req.user.id, so on an '
    + 'admin pivot it would grade the VIEWER\'s calls while showing another user\'s list');
});

test('the cost shown is derived from the count, and scales', () => {
  const cf = (n) => control('owner', { gradeConfirm: { scope: 'all', count: n } });
  assert.match(cf(291), /291 calls/);
  assert.match(cf(291), /\$70/, '291 x $0.24 should read about $70');
  assert.match(cf(10), /\$2\.40/);
  assert.match(cf(1), /under \$1/);
  assert.match(cf(1), /1 call\b/, 'singular, not "1 calls"');
});

test('the confirm step does not dispatch — it offers a choice', () => {
  const h = control('owner', { gradeConfirm: { scope: '30d', count: 95 } });
  assert.match(h, /gradeBacklogGo\(\)/, 'a Start control');
  assert.match(h, /gradeBacklogCancel\(\)/, 'and a way out');
  assert.ok(!/<select/.test(h), 'the window picker is replaced while confirming, so it cannot re-fire');
});

test('a stalled run SAYS SO instead of spinning', () => {
  const run = { total: 100, remaining: 40, failed: true, msg: 'No calls have finished for 5 minutes.' };
  const h = control('owner', { gradeRun: run });
  assert.match(h, /Grading stopped/i);
  assert.match(h, /40 still ungraded/);
  assert.ok(!/spinner-tiny/.test(h), 'a dead run must not still show a spinner');
});

test('a running run shows measured progress', () => {
  const h = control('owner', { gradeRun: { total: 100, remaining: 40, done: false, failed: false } });
  assert.match(h, /Grading 60 of 100/);
  assert.match(h, /40 to go/);
  assert.match(h, /width:60%/);
});

test('the stall window clears the measured worst-case call time', () => {
  const live = stripComments(HTML);
  const ticks = /GRADE_STALL_TICKS = (\d+)/.exec(live);
  const ms = /GRADE_POLL_MS = (\d+)/.exec(live);
  assert.ok(ticks && ms, 'stall constants are gone');
  const windowSec = Number(ticks[1]) * Number(ms[1]) / 1000;
  assert.ok(windowSec > 247,
    'measured max per-call analysis time is 247s; a stall window of ' + windowSec
    + 's would report a healthy run as dead');
});

test('the poll repaints ONLY the control, not the page', () => {
  const src = fnSource('paintGradeBacklog', '\n  async function gradeBacklogAsk', 200);
  assert.match(src, /querySelectorAll\('\.grade-backlog-host'\)/,
    'a full re-render every 15s replays every .fade-in entrance — the blink already '
    + 'caused once by eight lanes re-rendering the team page');
});
