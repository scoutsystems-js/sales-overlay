'use strict';
/**
 * ⚠⚠⚠ "ADD CARD DOES NOTHING" — A 403 IS NOT AN ERROR AND NEITHER IS "EMPTY".
 *
 * `fetchTeamJSON` turns a 403 into `{ _forbidden: true }`, which is NOT `_error`.
 * FOUR functions on this surface tested `_error` and sailed past a permission
 * failure into the no-cards branch. Measured on the deployed page with a
 * closer's real state (403 on every team lane):
 *
 *     the page read "This board is empty — Add the numbers you want to see
 *     first thing", with a WORKING Edit button, and "+ Add card" opened a modal
 *     containing NOTHING but its own header.
 *
 * ⚠⚠ TWO RULES BROKEN AT ONCE. A permission failure rendering as an empty board
 * is *a data problem must never render as good news*; a dialog with no content
 * is indistinguishable from a control that does nothing. The outcome must be
 * one of three: it works, it is not on screen, or it says why.
 *
 * ⚠ AND ONE ORDERING FAULT THAT CONVERTS ANY RENDER ERROR INTO SILENCE:
 * dashOpenPicker rendered INTO the modal before revealing it, so a throw
 * anywhere in the render meant the modal never appeared.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/* ⚠ THE SLICE STOPS AT the closing brace and does not include it, so anything
   executed from a slice must be closed first — otherwise new Function throws a
   SyntaxError that reads as a defect in the code under test, not in the harness. */
const CLOSE = '\n}\n';

function fn(name, min, max, src) {
  const s = src || LIVE;
  const at = s.indexOf('function ' + name);
  assert.ok(at !== -1, 'no such function: ' + name);
  const body = s.slice(at, s.indexOf('\n  }', at));
  assert.ok(body.length > min && body.length < max, name + ' slice: ' + body.length);
  return body;
}

test('⚠⚠ ONE predicate decides it — not a condition repeated per site', () => {
  const p = fn('laneProblem', 80, 600);
  assert.ok(/_forbidden/.test(p) && /_error/.test(p), 'it must know both');
  assert.ok(/return 'forbidden'/.test(p) && /return 'error'/.test(p),
    'and keep them APART — they need different words and the same gate');

  /* Executed, not read: a null lane is "still loading" and must NOT be a problem,
     or every skeleton becomes an error message. */
  /* ⚠ THE SLICE STOPS AT the closing brace and does not include it, so it must
     be closed before executing — otherwise new Function throws a SyntaxError
     that reads as a defect in the code under test rather than in the harness. */
  const laneProblem = new Function(p + CLOSE + ' return laneProblem;')();
  assert.strictEqual(laneProblem(null), null, 'a lane that has not landed is not a failure');
  assert.strictEqual(laneProblem(undefined), null);
  assert.strictEqual(laneProblem({ cards: [] }), null, 'a genuinely empty payload is not a failure either');
  assert.strictEqual(laneProblem({ _forbidden: true }), 'forbidden');
  assert.strictEqual(laneProblem({ _error: 'boom' }), 'error');
});

test('⚠⚠ every reader of a team lane on this surface handles a 403', () => {
  /* ⚠ ENUMERATE BY CAPABILITY, not by the ones that reported. Any function here
     that branches on `_error` must also account for `_forbidden`, directly or
     through the shared predicate — otherwise a 403 falls into its success path. */
  ['renderTeamDashboard', 'dashGaugeHtml', 'dashRenderPicker', 'dashEnterEdit'].forEach((name) => {
    const body = fn(name, 100, 6000);
    if (!/_error/.test(body) && !/laneProblem/.test(body)) return;   // reads no lane state
    assert.ok(/laneProblem/.test(body),
      name + ' branches on a lane failure without the shared predicate — that is how '
      + 'a 403 became "This board is empty"');
  });
});

test('⚠⚠⚠ a 403 must NEVER render as an empty board', () => {
  const body = fn('renderTeamDashboard', 800, 6000);
  /* ⚠⚠ ASSERT THE BRANCH, NOT THE MENTION. My first version located
     `laneProblem(d)` anywhere in the function — and passed with the branch
     deleted, because the dead `var problem = laneProblem(d)` assignment was
     still there. A guard satisfied by an assignment nobody reads is the
     computing-a-check-and-ignoring-its-result shape. */
  const branchAt = body.indexOf('else if (problem && !e) body = laneProblemHtml(');
  const emptyAt = body.indexOf('dashEmptyHtml()');
  assert.ok(branchAt !== -1, 'the problem BRANCH must exist, not merely the call');
  assert.ok(emptyAt !== -1, 'and the empty-board branch must exist to compare against');
  assert.ok(branchAt < emptyAt,
    'the problem branch must come FIRST — after the cards branch it is unreachable, '
    + 'which is exactly how a permission failure rendered as an invitation to add cards');
});

test('⚠⚠ no controls over a board that could not be loaded', () => {
  const body = fn('dashToolbarHtml', 400, 4000);
  assert.ok(/if \(!e && laneProblem\(d\)\) return/.test(body),
    'Edit, New Board and Add card all rendered over a 403, and pressing Edit WORKED. '
    + 'A control that cannot do its job must not be on screen.');
  /* ⚠ BUT THE TOAST HOST MUST SURVIVE, or the refusal below has nowhere to go
     and the silence comes straight back. */
  assert.ok(/return '<div class="dash-toast" id="dashToast"><\/div>'/.test(body),
    'the message host must outlive the controls');
});

test('⚠ entering edit mode REFUSES loudly — a silent return is the one outcome ruled out', () => {
  const body = fn('dashEnterEdit', 200, 2000);
  assert.ok(/dashToast\(/.test(body), 'it must say something');
  assert.ok(!/if \(!d \|\| d\._error\) return;/.test(body),
    'the old guard tested `_error` only, so a 403 walked past it into edit mode');
});

test('⚠⚠⚠ the picker is REVEALED before it is RENDERED', () => {
  const body = fn('dashOpenPicker', 300, 2500);
  const reveal = body.indexOf("classList.remove('hidden')");
  const render = body.indexOf('dashRenderPicker()');
  assert.ok(reveal !== -1 && render !== -1, 'both steps must exist');
  assert.ok(reveal < render,
    'rendering first means ANY throw inside the render leaves the modal hidden — the '
    + 'user presses a button and NOTHING HAPPENS, and the console error is in a '
    + 'function nobody would suspect from that symptom');
  assert.ok(/try \{ dashRenderPicker\(\); \}/.test(body) && /catch \(err\)/.test(body),
    'and a render failure must become a sentence, not an empty dialog');
});

test('⚠⚠ the picker NEVER renders blank — four states, four answers', () => {
  const body = fn('dashRenderPicker', 800, 6000);
  assert.ok(/cat === null \|\| cat === undefined/.test(body),
    '`undefined` is not `null` to a `=== null` guard, and the next line reads a property off it');
  assert.ok(/laneProblem\(cat\)/.test(body), 'a 403 has no `groups` and rendered a header and nothing else');
  assert.ok(/No metrics are available/.test(body),
    'and a genuinely empty catalog is a THIRD state — silence in a new costume otherwise');
});

test('⚠ the refusal copy is written for a customer', () => {
  const help = fn('laneProblemHtml', 150, 1200);
  assert.ok(/This is a manager view/.test(help), 'it says what happened');
  assert.ok(/Ask whoever manages your team/.test(help), 'and what they can do');
  /* ⚠ NO INTERNAL VOCABULARY. "403", "forbidden lane", "the endpoint" are all
     facts about how we are built, and a customer can act on none of them. */
  ['403', 'endpoint', 'lane', 'requireRole', 'payload', 'API']
    .forEach((w) => assert.ok(!new RegExp('\\b' + w + '\\b').test(help),
      'mechanism vocabulary in customer-visible copy: ' + w));
});
