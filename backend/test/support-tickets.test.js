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

/* ══ OWN TICKETS, THE REFERENCE LOOP, AND THE EMAIL NOTICE ════════════════ */

test('⚠⚠ THE OWN-TICKETS LIST IS A SEPARATE QUERY, NOT THE ADMIN ONE FILTERED', () => {
  const src = fn(SUPPORT, "router.get('/my-tickets'");
  assert.ok(/eq\('user_id', req\.user\.id\)/.test(src), 'server-enforced, never a client filter');
  // A hidden row is only a suggestion; one forgotten filter leaks every snapshot.
  assert.ok(!/requireRole/.test(src.slice(0, 140)), 'any authenticated person may see their own');
});

test('⚠⚠ THE SNAPSHOT COLUMNS ARE NOT EVEN SELECTED — stronger than not rendering them', () => {
  const src = fn(SUPPORT, "router.get('/my-tickets'");
  const sel = /\.select\('([^']+)'\)/.exec(src);
  assert.ok(sel, 'the select must be explicit, never select(*)');
  assert.ok(sel[1].indexOf('snapshot') === -1,
    'diagnostics describe an ACCOUNT, and on a shared company account that is not automatically theirs');
  /* ⚠ STRIP COMMENTS FIRST — the prose EXPLAINING that the columns are excluded
     names them, so a raw check reports the documentation of the rule as a
     violation of it. Nth instance of that trap, this time inside the guard. */
  /* ⚠ BOTH COMMENT FORMS. Dropping only lines that BEGIN with a marker leaves
     TRAILING comments — and the select line carries one naming the very columns
     it excludes. Third time this exact gap has bitten; strip leading AND
     trailing, always. */
  const code = src.split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, ''))
    .join('\n');
  assert.ok(!/snapshot/.test(code), 'and nothing downstream may reintroduce them');
});

test('⚠⚠ ONE DEFINITION OF THE REFERENCE — the value given must be the value found', () => {
  assert.strictEqual((SUPPORT.match(/function referenceFor/g) || []).length, 1, 'exactly one definition');
  // All three consumers derive it: the confirmation, the admin list, their own list.
  assert.ok((SUPPORT.match(/referenceFor\(/g) || []).length >= 3,
    'the raise, the admin list and the own list must all use it');
});

test('⚠⚠ THE ADMIN LIST CARRIES THE REFERENCE — it was previously shown NOWHERE', () => {
  // A code read out on a call could not be found, in the one moment it exists for.
  const src = fn(SUPPORT, "router.get('/tickets'");
  assert.ok(/reference: referenceFor/.test(src), 'the API must return it');
  assert.ok(/support-ref-admin/.test(ADMIN), 'and the row must display it');
  assert.ok(/ticketSearch/.test(ADMIN), 'with a way to search on it');
});

test('⚠ THE SEARCH DISTINGUISHES "no matches" FROM "no tickets"', () => {
  // Different facts: one means you searched for something absent, the other that
  // there is nothing at all. The wrong one sends someone looking again.
  assert.ok(/Nothing matches/.test(ADMIN) && /No tickets\./.test(ADMIN));
});

test('⚠⚠ THEY ARE TOLD REPLIES COME BY EMAIL, BEFORE THEY SEND', () => {
  // There is no in-app messaging, so without this "no reply in Scout" reads as
  // "nobody looked" — the silence this whole flow exists to remove.
  const formAt = DASH.indexOf('id="supportModal"');
  const form = DASH.slice(formAt, formAt + 1600);
  assert.ok(/comes by email/i.test(form), 'the FORM must say it, not only the confirmation');
  const client = fn(LIVE, 'async function sendSupport', 200, 5000);
  assert.ok(/by email/i.test(client), 'and the confirmation repeats it');
});

test('⚠ NO NOTIFICATION MACHINERY WAS BUILT HERE', () => {
  /* Filed as a hard prerequisite for EOD approval. A notification system built
     as a side effect of a support tool is how it ends up wrong for everything
     else that needs it. */
  assert.ok(!/notification/i.test(SUPPORT), 'no notification concepts in the support route');
  assert.ok(!/unread|read_at|deliver/i.test(SUPPORT), 'and none of its vocabulary');
});

test('⚠ LOADING THEIR OWN REPORTS MUST NEVER BLOCK THE FORM', () => {
  const src = fn(LIVE, 'async function loadMyTickets', 200, 3000);
  assert.ok(/if \(!res\.ok\) \{ host\.innerHTML = ''; return; \}/.test(src),
    'a failure here must be silent — the point of the modal is to REPORT a problem');
  assert.ok(/catch \(e\) \{ host\.innerHTML = ''; \}/.test(src));
});
