/**
 * THE CALL REVIEW PAGE, FOR A MANAGER VIEWING A REP (fixed 2026-08-29).
 *
 * ⚠⚠ THE BUG: the Calls LIST already had a cross-user variant
 * (/admin/fathom-calls/:user_id) and the page it links to did NOT — the review
 * route was always scoped to req.user.id. So a manager or owner could list a
 * rep's calls perfectly and EVERY CLICK returned 404 "Call not found". That is
 * the coaching page, for every rep, for every manager: the product.
 *
 * ⚠ It is the shared-carrier family in a new place — two halves of one journey
 * choosing their scope in different ways. The list asked isSelf(); the review
 * did not ask at all.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FATHOM = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

function code(s) {
  return s.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
          .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

test('the review payload has ONE implementation, shared by both routes', () => {
  const f = code(FATHOM);
  assert.ok(/async function loadCallReview\(admin, callId, ownerUserId\)/.test(f),
    'the payload builder must be extracted, not duplicated');
  assert.ok(/router\._loadCallReview\s*=\s*loadCallReview/.test(f), 'and exported for the admin route');
  assert.ok(/_loadCallReview\(/.test(code(ADMIN)), 'the admin route must reuse it rather than copy it');
});

test('the OWNER is an argument, never a request parameter read inside the builder', () => {
  const f = code(FATHOM);
  const at = f.indexOf('async function loadCallReview');
  const end = f.indexOf('\nrouter.get(', at);
  const body = f.slice(at, end);
  assert.ok(body.length > 500, 'slice must cover the builder: ' + body.length);
  /* ⚠ If the builder ever read req.params/req.user itself, the self route would
     stop being structurally incapable of naming another user — which is the
     whole reason this is an argument. */
  assert.ok(!/req\.(params|user|query)/.test(body),
    'the builder must not read the request — the caller decides whose call it is');
  assert.ok(/callResult\.data\.user_id !== ownerUserId/.test(body),
    'and it must still ownership-check, as the last line of defence');
});

test('the SELF route stays scoped to req.user.id — no target parameter was added', () => {
  const f = code(FATHOM);
  const at = f.indexOf("router.get('/calls/:id'");
  const body = f.slice(at, at + 700);
  assert.ok(/loadCallReview\(getAdminClient\(\), callId, userId\)/.test(body),
    'the self route must pass req.user.id and nothing else');
  assert.ok(!/req\.query\.user|target_user|user_id/.test(body),
    'a target parameter on the self-serve route is one bad argument from a leak');
});

test('the cross-user route is role-gated AND scope-checked, reusing the list predicate', () => {
  const a = code(ADMIN);
  const at = a.indexOf("router.get('/fathom-calls/:user_id/:call_id'");
  assert.ok(at > 0, 'the cross-user review route is missing');
  const body = a.slice(at, a.indexOf('\n});', at));
  assert.ok(body.length > 400, 'slice must cover the route: ' + body.length);
  assert.ok(/requireRole\(\['manager', 'owner'\]\)/.test(a.slice(at, at + 200)),
    'manager+owner only');
  assert.ok(/scopeCheck\.data\.managed_by !== req\.user\.id/.test(body),
    'a non-owner may only reach their OWN reps — the same predicate the list uses');
  assert.ok(/req\.user\.role !== 'owner'/.test(body), 'an owner passes platform-wide');
});

test('the client picks the review scope the SAME way the list does', () => {
  const h = code(HTML);
  const at = h.indexOf('async function fetchCallReview');
  const body = h.slice(at, at + 900);
  assert.ok(at > 0 && body.length > 300, 'fetchCallReview is missing — anchor stale');
  assert.ok(/isSelf\(\)/.test(body),
    'the review must branch on isSelf(), exactly as the list does');
  assert.ok(/\/admin\/fathom-calls\/'\s*\+\s*encodeURIComponent\(state\.viewingUserId\)/.test(body),
    'and use the cross-user route when viewing someone else');
  // the list's own choice, so the two cannot drift apart unnoticed
  assert.ok(/isSelf\(\) \? '\/fathom\/calls' : '\/admin\/fathom-calls\//.test(h),
    'the list still chooses the same way — if this changes, the review must too');
});

/* ── the nested-helper defect found in the same pass ───────────────────────── */

test('the exclusion label helpers are TOP LEVEL, not nested in a renderer', () => {
  const script = (HTML.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [])
    .sort((a, b) => b.length - a.length)[0];
  assert.ok(script && script.length > 10000, 'could not find the page script');

  // brace depth, skipping strings and comments — indentation is cosmetic and lied
  function depthAt(src, idx) {
    let d = 0, i = 0, q = null, line = false, blk = false;
    while (i < idx) {
      const c = src[i], n = src[i + 1];
      if (line) { if (c === '\n') line = false; i++; continue; }
      if (blk) { if (c === '*' && n === '/') { blk = false; i += 2; continue; } i++; continue; }
      if (q) { if (c === '\\') { i += 2; continue; } if (c === q) q = null; i++; continue; }
      if (c === '/' && n === '/') { line = true; i += 2; continue; }
      if (c === '/' && n === '*') { blk = true; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; i++; continue; }
      if (c === '{') d++; else if (c === '}') d--;
      i++;
    }
    return d;
  }

  /* ⚠ THEY WERE INSERTED INSIDE THE CARD RENDERER (depth 4 while every sibling
     is 3). That PARSES — a nested declaration is legal and hoists — so both
     `node -c` and the suite stayed green, while toggleNotSalesFromRow calls
     exclusionLabel() from depth 3 and would have thrown a ReferenceError at
     runtime. Only brace depth catches it. */
  const ref = depthAt(script, script.indexOf('async function toggleNotSalesFromRow'));
  ['function exclusionLabel', 'function exclusionTitle'].forEach(name => {
    const i = script.indexOf(name);
    assert.ok(i > 0, name + ' is missing');
    assert.strictEqual(depthAt(script, i), ref,
      name + ' must sit at the same scope as its callers, not nested inside a renderer');
  });
});
