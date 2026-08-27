/**
 * THE TICKET FLOW.
 *
 * ⚠⚠ ONE FEATURE, TWO PERMISSION ANSWERS, and conflating them is a data leak:
 * SUBMITTING is universal (closers are the ones who hit problems); the LIST is
 * admin-only (it carries other companies' account state in every snapshot).
 *
 * ⚠⚠ AND THE FAILURE MODE THAT MATTERS: a support tool that refuses a report
 * because its own diagnostics broke fails at exactly the moment someone needs
 * to reach us. Proven live — with buildSnapshot throwing, the ticket still
 * returned 200, the message was stored, and the failure was RECORDED.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORT = fs.readFileSync(path.join(__dirname, '..', 'routes', 'support.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');
const MIG = fs.readFileSync(path.join(__dirname, '..', 'migrations', '052_support_tickets.sql'), 'utf8');
// ⚠ Strip comments FIRST — line comments before block, or a `/*` inside a `//`
// is a false opener that swallows the file.
const LIVE = DASH.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function fn(src, name, min, max) {
  const at = src.indexOf(name);
  assert.ok(at !== -1, 'stale anchor: ' + name);
  /* ⚠ THREE TERMINATORS, because the same helper reads route handlers (\n});),
     top-level functions (\n}) and INDENTED client functions (\n  }). Missing the
     indented one made a client slice run 296,944 chars to the end of the file and
     fail for a reason that had nothing to do with the code. */
  const ends = [src.indexOf('\n});', at), src.indexOf('\n}\n', at), src.indexOf('\n  }', at)]
    .filter((i) => i !== -1);
  const out = src.slice(at, Math.min.apply(null, ends));
  assert.ok(out.length > (min || 80) && out.length < (max || 6000), name + ' slice: ' + out.length);
  return out;
}

test('⚠⚠ THE TICKET LANDS EVEN IF THE SNAPSHOT FAILS', () => {
  const src = fn(SUPPORT, "router.post('/tickets'");
  // The snapshot call must be inside its own try, and the insert must follow it
  // unconditionally — never inside the try, never gated on success.
  const sIdx = src.indexOf('buildSnapshot');
  const iIdx = src.indexOf("from('support_tickets')");
  assert.ok(sIdx !== -1 && iIdx > sIdx, 'the insert must come after, and outside, the snapshot attempt');
  assert.ok(/catch \(snapErr\)/.test(src), 'a snapshot failure must be caught, not thrown');
  assert.ok(!/return res\.status\(5\d\d\)[\s\S]{0,80}snapErr/.test(src),
    'a diagnostics failure must never refuse the report');
});

test('⚠ AND THE FAILURE IS RECORDED — "no snapshot" and "the snapshot broke" are different facts', () => {
  const src = fn(SUPPORT, "router.post('/tickets'");
  assert.ok(/snapshot_error: snapshotError/.test(src),
    'an empty snapshot read as "nothing was wrong" is the absent-vs-excluded collapse');
  assert.ok(/snapshot_attached/.test(src), 'and the caller is told whether it attached');
});

test('⚠⚠ SUBMIT IS UNIVERSAL, THE LIST IS ADMIN-ONLY', () => {
  const post = fn(SUPPORT, "router.post('/tickets'");
  assert.ok(/requireAuth/.test(post.slice(0, 120)), 'authenticated');
  assert.ok(!/requireRole/.test(post.slice(0, 120)), 'but NOT role-gated — closers hit problems');

  const get = fn(SUPPORT, "router.get('/tickets'");
  assert.ok(/requireRole\('owner'\)/.test(get.slice(0, 160)),
    'the list carries other companies\' state and must be gated on the server');
  const patch = fn(SUPPORT, "router.patch('/tickets/:id'");
  assert.ok(/requireRole\('owner'\)/.test(patch.slice(0, 160)));
});

test('⚠⚠ THE SNAPSHOT IS STORED, NOT REGENERATED ON READ', () => {
  // Regenerating answers "what is true now", looks identical, and would make a
  // cleared backlog read as though it never existed.
  const get = fn(SUPPORT, "router.get('/tickets'");
  assert.ok(/select\([^)]*snapshot/.test(get), 'the list must SELECT the stored snapshot');
  assert.ok(!/buildSnapshot/.test(get), 'and must never rebuild it');
  assert.ok(/never regenerate it on read/i.test(MIG), 'the schema must say so too');
});

test('⚠ AN EMPTY MESSAGE IS REFUSED — the message IS the ticket', () => {
  const src = fn(SUPPORT, "router.post('/tickets'");
  assert.ok(/if \(!message\) return res\.status\(400\)/.test(src));
});

test('⚠⚠ ONE CONTROL, RENDERED ONCE, OUTSIDE #content', () => {
  // render() replaces #content on every view. A control inside it would have to
  // be copied onto ~15 pages — this codebase's most repeated mistake.
  assert.strictEqual((DASH.match(/id="supportFab"/g) || []).length, 1, 'exactly one control');
  const bodyAt = DASH.indexOf('<body>');
  const fabAt = DASH.indexOf('id="supportFab"');
  const contentAt = DASH.indexOf('<div id="content"');
  assert.ok(fabAt > bodyAt, 'must be real markup, not a comment');
  assert.ok(contentAt === -1 || fabAt < contentAt, 'must sit outside the re-rendered container');
});

test('⚠⚠ THE PERSON GETS A REFERENCE — they must not submit into silence', () => {
  const src = fn(SUPPORT, "router.post('/tickets'");
  assert.ok(/reference: ref/.test(src), 'the server must return something concrete to quote');
  const client = fn(LIVE, 'async function sendSupport', 200, 4000);
  assert.ok(/body\.reference/.test(client), 'and the confirmation must show it');
});

test('⚠ A SEND FAILURE OFFERS ANOTHER ROUTE — this is the one place an apology alone is unacceptable', () => {
  const client = fn(LIVE, 'async function sendSupport', 200, 4000);
  assert.ok(/mailto:justin@scoutsystems\.io/.test(client),
    'they are already reporting that something is broken; give them a way through');
});

test('⚠ THE PAGE THEY WERE ON TRAVELS WITH THE TICKET — free context the app already holds', () => {
  const client = fn(LIVE, 'async function sendSupport', 200, 4000);
  assert.ok(/page: supportPageLabel\(\)/.test(client));
  const post = fn(SUPPORT, "router.post('/tickets'");
  assert.ok(/page: page/.test(post), 'and must be stored');
});

test('⚠ THE ADMIN LIST SHOWS A BROKEN SNAPSHOT AS BROKEN, not as an empty one', () => {
  assert.ok(/snapshot_error/.test(ADMIN), 'the list must distinguish the two');
  assert.ok(/Diagnostics failed when this was raised/.test(ADMIN));
});

test('⚠ THE ROUTER IS MOUNTED AFTER the exact-match support PAGE', () => {
  const pageAt = INDEX.indexOf("app.get('/support'");
  const routerAt = INDEX.indexOf("app.use('/support'");
  assert.ok(pageAt !== -1 && routerAt > pageAt,
    'the public support page must keep winning /support; the router serves /support/tickets');
});
