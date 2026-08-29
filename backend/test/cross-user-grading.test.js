/**
 * A MANAGER GRADES A REP'S CALLS — NOT THEIR OWN.
 *
 * ⚠⚠ THAT SINGLE ASSERTION IS THE WHOLE FEATURE. The grading control was
 * self-only BY DESIGN because it grades whoever is signed in; pointing it at a
 * rep without changing that would have spent money re-grading the VIEWER's
 * calls while showing someone else's list — a wrong action with no error.
 *
 * ⚠ THE GUARD WAS NOT REMOVED, IT WAS ROUTED AROUND. POST /fathom/update-analyses
 * still passes req.user.id and remains structurally incapable of naming another
 * user. The cross-user case is a SEPARATE role-gated route.
 *
 * Verified against production with dry runs (nothing spent): a manager pricing
 * their rep's 30 days returned 95 calls; the same manager pricing their OWN
 * returned 0. Different numbers is the proof — a shared number would prove
 * nothing about which set was selected.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FATHOM = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = HTML.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function route(name) {
  const at = FATHOM.indexOf(name);
  assert.ok(at !== -1, 'stale anchor: ' + name);
  /* ⚠ A ROUTER HANDLER ENDS `\n});`, A PLAIN FUNCTION `\n}`. Using one
     terminator for both silently over-slices — my first version ran past the end
     of runUpdateAnalyses and the assertion failed for a reason that had nothing
     to do with the code. Take whichever boundary comes first. */
  const ends = [FATHOM.indexOf('\n});', at), FATHOM.indexOf('\n}\n', at)].filter((i) => i !== -1);
  const end = Math.min.apply(null, ends);
  const src = FATHOM.slice(at, end);
  /* ⚠ The bound catches a RUNAWAY slice, not function length — runUpdateAnalyses
     is genuinely ~9.4k because it is the whole batch. */
  assert.ok(src.length > 100 && src.length < 14000, name + ' slice: ' + src.length);
  return src;
}

test('⚠⚠ THE SELF ROUTE STILL CANNOT NAME ANOTHER USER', () => {
  const src = route("router.post('/update-analyses', requireAuth");
  assert.ok(/runUpdateAnalyses\(req, res, req\.user\.id/.test(src),
    'it must pass the caller and nothing else — that is the guard, intact');
  assert.ok(!/req\.params/.test(src), 'it must not read a target from the URL');
});

test('⚠⚠ THE CROSS-USER ROUTE GRADES THE TARGET, NOT THE CALLER', () => {
  const src = route("router.post('/update-analyses/:user_id'");
  assert.ok(/runUpdateAnalyses\(req, res, target/.test(src),
    'the whole feature: it must pass the REP, or it spends money re-grading the viewer');
  assert.ok(/req\.params\.user_id/.test(src));
});

test('⚠ MANAGERS AND ABOVE ONLY — a rep must not grade a peer', () => {
  const src = route("router.post('/update-analyses/:user_id'");
  assert.ok(/role !== 'manager' && role !== 'owner'/.test(src), 'plain users refused');
  assert.ok(/403/.test(src));
});

test('⚠⚠ THE BOUNDARY: a manager may only grade their OWN team', () => {
  // Decided and enforced, not left to the UI. Verified live: manager -> a rep on
  // another board is 403; owner -> the same rep is 200.
  const src = route("router.post('/update-analyses/:user_id'");
  assert.ok(/managed_by !== req\.user\.id/.test(src),
    'the same predicate every other cross-user route uses');
  assert.ok(/role !== 'owner'/.test(src), 'and an owner is unrestricted');
});

test('⚠⚠ ALL-TIME STAYS OWNER-ONLY, AND ON THE ACTOR\'S ROLE — no second cap', () => {
  const src = route('async function runUpdateAnalyses');
  assert.ok(/scopeAsked === 'all' && actorRole !== 'owner'/.test(src),
    'it must key on the SIGNED-IN role, or a manager inherits an owner rep\'s allowance');
  // The cap is reused, never duplicated. Two caps that disagree is the same
  // defect class as two panels answering about different populations.
  assert.strictEqual((FATHOM.match(/max_scope/g) || []).length, 1, 'exactly one cap definition');
});

test('⚠ FAIL CLOSED — requireAuth fails OPEN, so an undefined role must refuse', () => {
  const src = route("router.post('/update-analyses/:user_id'");
  assert.ok(/role !== 'manager' && role !== 'owner'/.test(src),
    'a positive check refuses on undefined; a negative one would grant');
});

test('⚠⚠ THE CLIENT SENDS THE TARGET — a server that accepts it changes nothing alone', () => {
  const at = LIVE.indexOf('function gradeBacklogUrl');
  assert.ok(at !== -1, 'stale anchor: gradeBacklogUrl');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(/isSelf\(\)/.test(src) && /viewingUserId/.test(src),
    'self -> the self route, pivoted -> the target route');
  // Both call sites must go through it, or one silently grades the viewer.
  /* ⚠ STRIP TRAILING `//` COMMENTS TOO. The line filter only drops lines that
     BEGIN with `//`, so a comment at the end of a state declaration mentioning
     the URL counted as a call site — the comment-as-code trap, in my own guard. */
  const code = LIVE.split('\n').map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  assert.strictEqual((code.match(/fetch\('\/fathom\/update-analyses'/g) || []).length, 0,
    'no call site may hardcode the self URL');
  assert.ok((LIVE.match(/gradeBacklogUrl\(\)/g) || []).length >= 2, 'both dry-run and go use it');
});

test('⚠ THE CONTROL RENDERS ON A PIVOT ONLY FOR MANAGERS AND ABOVE', () => {
  const at = LIVE.indexOf('function canGradeViewedUser');
  assert.ok(at !== -1, 'stale anchor');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(/isSelf\(\)/.test(src) && /manager/.test(src) && /owner/.test(src));
  assert.ok(/canGradeViewedUser\(\) && gradeBacklogWorkCount\(\) > 0/.test(LIVE),
    'and the render gate must use it');
});

test('⚠⚠ THE CONFIRMATION NAMES WHOSE CALLS — AND NO LONGER WHOSE MONEY', () => {
  // ⚠⚠ CONVERTED 2026-08-28, NOT DELETED. This test pinned two properties and
  // Justin ruled one of them OUT. Whose CALLS is still required — a manager
  // grading a rep's backlog should see whose calls they are. Whose MONEY is now
  // FORBIDDEN: the sentence "This is billed to the company, not to them" was
  // removed, not softened, because telling a rep whose money is being spent puts
  // a hesitation in their head about spending someone else's money on their own
  // coaching. There is no billing decision for them to make here.
  //
  // ⚠ The subject outlived the vehicle: deleting this test with the sentence
  // would have quietly stopped checking that the rep is named at all.
  const at = LIVE.indexOf('var whose = isSelf()');
  assert.ok(at !== -1, 'the confirmation must still distinguish self from a rep');
  const src = LIVE.slice(at, at + 900);
  assert.ok(src.length > 300, 'slice must cover the confirmation: ' + src.length);
  assert.ok(/viewedUserLabel\(\)/.test(src), 'it must still name the rep');
  assert.ok(/gradeCostText/.test(src), 'with the cost, as the self-serve one does');
  assert.ok(!/billed to the company/.test(src), 'the cost-ownership sentence must NOT come back');
  assert.ok(!/whoseMoney/.test(src), 'nor the variable that carried it');
});

test('⚠ THE REP LABEL NEVER RENDERS BLANK — a money dialog must not read "Grade 101 of ’s calls"', () => {
  const at = LIVE.indexOf('function viewedUserLabel');
  const src = LIVE.slice(at, LIVE.indexOf('\n  }', at));
  assert.ok(/'this rep'/.test(src), 'must fall back to a generic label, never an empty string');
});
