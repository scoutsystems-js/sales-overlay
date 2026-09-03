/**
 * THE FOLLOW-UP FLAG (H706): a LINKED later call for a prospect is a follow-up; no link
 * and no earlier call is booked; path 3 (the one-word key) never manufactures a
 * follow-up; the human mark always wins and the automatic setter cannot overwrite it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const ck = require('../lib/call-kind');

const E = [{ id: 'c-first', call_date: '2026-08-01T10:00:00Z', call_kind: 'booked' }, { id: 'c-second', call_date: '2026-08-10T10:00:00Z', call_kind: 'follow_up' }];

test('a linked later call (path 1 or 2) for a prospect with an earlier call is a follow-up of the earliest BOOKED call', () => {
  const d = ck.deriveCallKind({ linkPath: 'invitee_email', prospectId: 'p', callDate: '2026-08-20T10:00:00Z', earlierCalls: E });
  assert.deepStrictEqual(d, { call_kind: 'follow_up', call_kind_source: 'linked', follows_call_id: 'c-first' });
  assert.strictEqual(ck.deriveCallKind({ linkPath: 'title_name', prospectId: 'p', callDate: '2026-08-20T10:00:00Z', earlierCalls: E }).call_kind, 'follow_up');
  assert.strictEqual(ck.deriveCallKind({ linkPath: 'display_name', prospectId: 'p', callDate: '2026-08-20T10:00:00Z', earlierCalls: E }).call_kind, 'follow_up');
});

test('no link and no earlier call → booked; an earlier call under the one-word key (path 3) → still booked', () => {
  assert.deepStrictEqual(ck.deriveCallKind({ linkPath: 'title_name', prospectId: 'p', callDate: '2026-08-20T10:00:00Z', earlierCalls: [] }), { call_kind: 'booked', call_kind_source: 'first', follows_call_id: null });
  assert.strictEqual(ck.deriveCallKind({ linkPath: 'resolved_name', prospectId: 'p', callDate: '2026-08-20T10:00:00Z', earlierCalls: E }).call_kind, 'booked', 'a collision-prone key never manufactures a follow-up');
  assert.strictEqual(ck.deriveCallKind({ linkPath: null, prospectId: null, earlierCalls: E }).call_kind, 'booked');
  assert.strictEqual(ck.deriveCallKind({ linkPath: 'invitee_email', prospectId: 'p', callDate: '2026-07-01T10:00:00Z', earlierCalls: E }).call_kind, 'booked', 'only calls BEFORE this one count as earlier');
});

test('when every earlier call is itself a follow-up, the earliest of them anchors', () => {
  const d = ck.deriveCallKind({ linkPath: 'invitee_email', prospectId: 'p', callDate: '2026-08-20T10:00:00Z', earlierCalls: [E[1]] });
  assert.strictEqual(d.follows_call_id, 'c-second');
});

test('⚠⚠ the automatic setter (EXECUTED) writes only where NO HUMAN HAS SPOKEN — .is(call_kind_marked_by, null) is on the update', async () => {
  const calls = [];
  const admin = { from(t) { return { update(p) { const rec = { t, p, filters: [] }; const b = { eq(k, v) { rec.filters.push([k, v]); return b; }, is(k, v) { rec.filters.push(['is', k, v]); return b; },
    then(res) { calls.push(rec); return Promise.resolve({ error: null }).then(res); } }; return b; } }; } };
  const ok = await ck.setCallKindAuto(admin, 'call-1', 'user-1', { call_kind: 'follow_up', call_kind_source: 'linked', follows_call_id: 'c-first' });
  assert.strictEqual(ok, true);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].p, { call_kind: 'follow_up', call_kind_source: 'linked', follows_call_id: 'c-first' });
  assert.deepStrictEqual(calls[0].filters, [['id', 'call-1'], ['user_id', 'user-1'], ['is', 'call_kind_marked_by', null]], 'scoped by id, user_id, and the human guard');
  const thrower = { from() { throw new Error('down'); } };
  assert.strictEqual(await ck.setCallKindAuto(thrower, 'c', 'u', { call_kind: 'booked', call_kind_source: 'first' }), false, 'never throws');
});

test('the human setter stamps who and when, and a booked mark clears follows_call_id', async () => {
  const calls = [];
  const admin = { from(t) { return { update(p) { const rec = { t, p, filters: [] }; const b = { eq(k, v) { rec.filters.push([k, v]); return b; }, select() { return b; }, single() { calls.push(rec); return Promise.resolve({ data: Object.assign({ id: 'c' }, p), error: null }); } }; return b; } }; } };
  const r = await ck.setCallKindHuman(admin, 'c', 'follow_up', 'actor', 'c-first');
  assert.strictEqual(r.data.call_kind_source, 'human'); assert.strictEqual(calls[0].p.call_kind_marked_by, 'actor'); assert.ok(calls[0].p.call_kind_marked_at);
  assert.strictEqual(calls[0].p.follows_call_id, 'c-first');
  await ck.setCallKindHuman(admin, 'c', 'booked', 'actor', 'c-first');
  assert.strictEqual(calls[1].p.follows_call_id, null);
});

test('⚠⚠ the worker derives the kind right after the attach and sets it through the guarded setter; the route uses the human setter', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8'));
  const at = src.indexOf('attachProspect(admin, { userId: userId, callId: fathomCallId, link: link })');
  assert.ok(at !== -1);
  const after = src.slice(at, at + 1200);
  assert.ok(/earlierCallsFor\(admin, userId, attached\.prospect_id, callRow\.call_date, fathomCallId\)/.test(after), 'earlier calls of the SAME prospect are read');
  assert.ok(/deriveCallKind\(\{ linkPath: link\.path, prospectId: attached\.prospect_id/.test(after), 'derived from the link path');
  assert.ok(/setCallKindAuto\(admin, fathomCallId, userId, kind\)/.test(after), 'set through the human-guarded setter');
  const me = stripComments(fs.readFileSync(path.join(__dirname, '..', 'routes', 'me.js'), 'utf8'));
  assert.ok(/router\.post\('\/calls\/:id\/call-kind'/.test(me), 'the human route exists');
  const rt = me.slice(me.indexOf("router.post('/calls/:id/call-kind'"), me.indexOf("router.post('/calls/:id/call-kind'") + 2600);
  assert.ok(/canMarkNotSalesCall\(actor, ownerProfile\)/.test(rt), 'the same permission as not-a-sales-call (H352 stands)');
  assert.ok(/setCallKindHuman\(admin, callId, kind, req\.user\.id/.test(rt), 'writes through the human setter');
});
