/**
 * LINKING (Justin's approved policy, 2026-09-03, H705). Path 1: exactly one external
 * invitee email whose name agrees with the speaker → keyed by the email (exact). Path 2:
 * a Fathom title segment or a two-word Zoom display name whose first word equals the
 * resolved first name → keyed by the full name. Path 3: today's one-word key. Silence at
 * every step. THE EMPTY "Anthony" ROW IS THE TEST: a new Anthony Davis call attaches to
 * Anthony Davis, not to it — planted below and executed through attachProspect.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const { chooseLink, attachProspect, PATHS } = require('../lib/prospect-link');

const U = 'user-josh';
const inv = (name, email, ext) => ({ name, email, is_external: ext });

/* ── chooseLink: the three paths and the silences ─────────────────────────── */
test('path 1: exactly one external invitee whose name agrees with the speaker → keyed by the email', () => {
  const l = chooseLink({ resolvedName: 'Todd', invitees: [inv('Todd Erickson', 'Info@ResultsPMSC.com', true), inv('Yazan Younis', 'yazan@soberlivingriches.com', false)],
    titleSegment: 'Todd Erickson', source: 'fathom' });
  assert.deepStrictEqual(l, { path: PATHS.INVITEE_EMAIL, email: 'info@resultspmsc.com', display_name: 'Todd Erickson', name_key: 'todd erickson' });
});

test('the husband on his wife\'s account: the one external invitee is Mary, the speaker is John → NOT path 1', () => {
  const l = chooseLink({ resolvedName: 'John', invitees: [inv('Mary Smith', 'mary@x.com', true)], titleSegment: 'John Smith', source: 'fathom' });
  assert.strictEqual(l.path, PATHS.TITLE_NAME, 'path 2 by the title that names the speaker');
  assert.strictEqual(l.email, null, 'the account\'s email is never attached to the speaker');
  const noTitle = chooseLink({ resolvedName: 'John', invitees: [inv('Mary Smith', 'mary@x.com', true)], titleSegment: null, source: 'fathom' });
  assert.deepStrictEqual(noTitle, { path: PATHS.RESOLVED_NAME, email: null, display_name: 'John', name_key: 'john' }, 'else today\'s key');
});

test('two external invitees (the couple) → never path 1; path 2 by the title if it names the speaker; else path 3', () => {
  const two = [inv('Amy Engelhardt', 'amy@x.com', true), inv('Dan Engelhardt', 'dan@x.com', true)];
  assert.strictEqual(chooseLink({ resolvedName: 'Amy', invitees: two, titleSegment: 'Amy Engelhardt', source: 'fathom' }).path, PATHS.TITLE_NAME);
  assert.strictEqual(chooseLink({ resolvedName: 'Amy', invitees: two, titleSegment: null, source: 'fathom' }).path, PATHS.RESOLVED_NAME);
});

test('silence: placeholders, devices, a company name, a mismatched first name produce no link on that path', () => {
  const base = { resolvedName: 'Anthony', invitees: [], source: 'fathom' };
  assert.strictEqual(chooseLink(Object.assign({}, base, { titleSegment: 'Sober Living Riches' })).path, PATHS.RESOLVED_NAME, 'company name');
  assert.strictEqual(chooseLink(Object.assign({}, base, { titleSegment: 'Anthony NoLastname' })).path, PATHS.RESOLVED_NAME, 'placeholder');
  assert.strictEqual(chooseLink(Object.assign({}, base, { titleSegment: "Anthony's iPhone" })).path, PATHS.RESOLVED_NAME, 'device');
  assert.strictEqual(chooseLink(Object.assign({}, base, { titleSegment: 'Carrie Banks Wright' })).path, PATHS.RESOLVED_NAME, 'another person\'s title');
  assert.strictEqual(chooseLink(Object.assign({}, base, { titleSegment: 'Anthony' })).path, PATHS.RESOLVED_NAME, 'one word is not a full name');
  assert.strictEqual(chooseLink(Object.assign({}, base, { invitees: [inv('Anthony Davis', 'a@x.com', null)], titleSegment: null })).path, PATHS.RESOLVED_NAME, 'is_external unknown is not external');
  assert.strictEqual(chooseLink({ resolvedName: null }).path, null, 'no resolved name → no attach, as today');
});

test('Zoom: a two-word prospect display name whose first word is the speaker\'s → path 2 (display_name); ambiguity or one word → path 3', () => {
  assert.deepStrictEqual(chooseLink({ resolvedName: 'Maggie', source: 'zoom', prospectDisplayNames: ['Maggie Chen'], title: 'Impromptu Zoom Meeting' }),
    { path: PATHS.DISPLAY_NAME, email: null, display_name: 'Maggie Chen', name_key: 'maggie chen' });
  assert.strictEqual(chooseLink({ resolvedName: 'Maggie', source: 'zoom', prospectDisplayNames: ['Maggie Chen', 'Maggie Ross'] }).path, PATHS.RESOLVED_NAME, 'two candidates → silence');
  assert.strictEqual(chooseLink({ resolvedName: 'Maggie', source: 'zoom', prospectDisplayNames: ['iPhone', 'Maggie'] }).path, PATHS.RESOLVED_NAME);
  assert.strictEqual(chooseLink({ resolvedName: 'Maggie', source: 'zoom', prospectDisplayNames: ['Maggie Chen'], titleSegment: 'Maggie Chen' }).path, PATHS.DISPLAY_NAME, 'on Zoom the title is not read');
});

/* ── attachProspect, EXECUTED against a fake with the live shape ───────────── */
function fakeAdmin(prospects) {
  const log = [];
  const chain = (table, op, payload) => {
    const rec = { table, op, payload, filters: {} };
    const b = { eq(k, v) { rec.filters[k] = v; return b; }, select() { return b; },
      maybeSingle() {
        if (table === 'prospects' && op === 'select') {
          const hit = prospects.find((p) => p.user_id === rec.filters.user_id && ((rec.filters.email && p.email === rec.filters.email) || (rec.filters.name_key && p.name_key === rec.filters.name_key)));
          return Promise.resolve({ data: hit ? { id: hit.id, email: hit.email || null } : null, error: null });
        }
        if (table === 'prospects' && op === 'insert') { const id = 'np-' + (prospects.length + 1); prospects.push(Object.assign({ id }, payload)); log.push(rec); return Promise.resolve({ data: { id }, error: null }); }
        return Promise.resolve({ data: null, error: null });
      },
      then(res) { log.push(rec); if (table === 'prospects' && op === 'update') { const p = prospects.find((x) => x.id === rec.filters.id); if (p) Object.assign(p, payload); } return Promise.resolve({ error: null }).then(res); } };
    return b;
  };
  return { log, prospects, from(t) { return { select: () => chain(t, 'select'), insert: (p) => chain(t, 'insert', p), update: (p) => chain(t, 'update', p) }; } };
}

test('⚠⚠ THE ANTHONY PLANT (EXECUTED): a new "Anthony Davis" call attaches to Anthony Davis, never to the empty one-word "Anthony" row', async () => {
  const admin = fakeAdmin([
    { id: 'p-anthony', user_id: U, display_name: 'Anthony', name_key: 'anthony' },
    { id: 'p-davis', user_id: U, display_name: 'Anthony Davis', name_key: 'anthony davis' },
  ]);
  const link = chooseLink({ resolvedName: 'Anthony', invitees: [], titleSegment: 'Anthony Davis', title: 'PS Sober Living Riches | Anthony Davis', source: 'fathom' });
  assert.strictEqual(link.path, PATHS.TITLE_NAME);
  const out = await attachProspect(admin, { userId: U, callId: 'call-new', link });
  assert.strictEqual(out.prospect_id, 'p-davis', 'attached to Anthony Davis');
  assert.strictEqual(out.created, false, 'no new row — the existing full-name prospect was found by key');
  const up = admin.log.find((r) => r.table === 'fathom_calls' && r.op === 'update');
  assert.deepStrictEqual(up.payload, { prospect_id: 'p-davis', prospect_link_path: 'title_name' });
  assert.deepStrictEqual(up.filters, { id: 'call-new', user_id: U }, 'scoped by id AND user_id');
  assert.ok(!admin.log.some((r) => r.payload && r.payload.prospect_id === 'p-anthony'), 'the one-word row is never touched');
});

test('attachProspect (EXECUTED): path 1 finds by email first, stamps the email onto a name-keyed prospect that had none, and creates with the email when new', async () => {
  const admin = fakeAdmin([{ id: 'p-todd', user_id: U, display_name: 'Todd Erickson', name_key: 'todd erickson', email: null }]);
  const link = chooseLink({ resolvedName: 'Todd', invitees: [inv('Todd Erickson', 'info@resultspmsc.com', true)], titleSegment: 'Todd Erickson', source: 'fathom' });
  const out = await attachProspect(admin, { userId: U, callId: 'c1', link });
  assert.strictEqual(out.prospect_id, 'p-todd');
  assert.strictEqual(admin.prospects[0].email, 'info@resultspmsc.com', 'the email is stamped');
  const out2 = await attachProspect(admin, { userId: U, callId: 'c2', link: chooseLink({ resolvedName: 'Todd', invitees: [inv('T. Erickson', 'info@resultspmsc.com', true)], titleSegment: 'Todd Erickson', source: 'fathom' }) });
  assert.strictEqual(out2.prospect_id, 'p-todd', 'found by EMAIL even though the invitee name is abbreviated');
  const created = await attachProspect(admin, { userId: U, callId: 'c3', link: chooseLink({ resolvedName: 'Nancy', invitees: [inv('Nancy Kaur', 'mehak@gmail.com', true)], titleSegment: 'Nancy Kaur', source: 'fathom' }) });
  assert.strictEqual(created.created, true);
  assert.strictEqual(admin.prospects.find((p) => p.id === created.prospect_id).email, 'mehak@gmail.com');
  const upd = admin.log.filter((r) => r.table === 'fathom_calls').pop();
  assert.strictEqual(upd.payload.prospect_link_path, 'invitee_email');
});

test('attachProspect never throws and attaches nothing on a null path', async () => {
  const thrower = { from() { throw new Error('down'); } };
  const out = await attachProspect(thrower, { userId: U, callId: 'c', link: chooseLink({ resolvedName: 'Todd', source: 'fathom' }) });
  assert.strictEqual(out.prospect_id, null);
  assert.strictEqual((await attachProspect(fakeAdmin([]), { userId: U, callId: 'c', link: chooseLink({ resolvedName: null }) })).prospect_id, null);
});

/* ── the worker call site ──────────────────────────────────────────────────── */
test('⚠⚠ analysis-worker attaches through chooseLink + attachProspect, feeds the three captured columns, and no longer keys by nameKey alone', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8'));
  const sel = src.match(/\.select\('id, fathom_call_id, call_date[^']*'\)/);
  assert.ok(sel && /calendar_invitees/.test(sel[0]) && /title_name_segment/.test(sel[0]), 'the call-row select carries the captured columns: ' + (sel && sel[0]));
  const at = src.indexOf('chooseLink({');
  assert.ok(at !== -1, 'chooseLink is called');
  const blk = src.slice(at, at + 700);
  assert.ok(/resolvedName:\s*resolvedProspect\.name/.test(blk) && /invitees:\s*callRow\.calendar_invitees/.test(blk) && /titleSegment:\s*callRow\.title_name_segment/.test(blk) && /prospectDisplayNames/.test(blk), 'fed from the captured columns: ' + blk.slice(0, 400));
  assert.ok(/attachProspect\(admin, \{ userId: userId, callId: fathomCallId, link: link \}\)/.test(src), 'attachProspect is awaited with the link');
  assert.ok(!/var pKey = nameKey\(resolvedProspect\.name\);/.test(src), 'the old nameKey-only attach is gone');
});
