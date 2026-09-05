/**
 * THE PASS-THROUGH IS A DEFECT, NOT A FEATURE (Justin, 2026-09-04, H728). A rep inherits from the team
 * head — already ruled, and how the knowledge base, corrections and the digest scope. The selling
 * context read the rep's OWN profile and stopped, so the grader context for every rep on Sober Living
 * Riches was ZERO characters while the head's qualifications read "10k saved, not living paycheck to
 * paycheck, 640 or above credit score" — and the missed signal flagged the same evening was a prospect
 * saying "I just don't have the financials for it". Inherit FIELD BY FIELD: a rep's own field, where it
 * has content, still wins. EXECUTED against a fake wire; a plant that keeps the head lookup and drops
 * its result yields 0 characters and fails here.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fetchSellingContext } = require('../lib/selling-context');

const HEAD = { user_id: 'head', managed_by: null, niche: 'Sober Living Homes Investing', offer: 'Done for you market research to identify and communicate with local agencies and organizations to place tenants in your properties.', qualifications: '10k saved, not living paycheck to paycheck, 640 or above credit score', script_raw: ('Hi! How are you? Where are you calling from today? Curious, how did you hear about us? ').repeat(6) };
const REP_EMPTY = { user_id: 'rep', managed_by: 'head', niche: null, offer: null, qualifications: null, script_raw: null };
const REP_OWN = { user_id: 'rep2', managed_by: 'head', niche: null, offer: 'My own offer wording that is long enough to count as a real field', qualifications: null, script_raw: null };
const MID = { user_id: 'mid', managed_by: 'head', niche: null, offer: null, qualifications: null, script_raw: null };
const DEEP = { user_id: 'deep', managed_by: 'mid', niche: null, offer: null, qualifications: null, script_raw: null };
const PROFILES = { head: HEAD, rep: REP_EMPTY, rep2: REP_OWN, mid: MID, deep: DEEP };
function fakeAdmin() {
  return { from(table) {
    const ch = { f: {}, select() { return ch; }, eq(k, v) { ch.f[k] = v; return ch; }, in() { return ch; },
      maybeSingle() { return Promise.resolve({ data: table === 'user_profiles' ? (PROFILES[ch.f.user_id] || null) : null, error: null }); },
      then(res) { return Promise.resolve({ data: [], error: null }).then(res); } };
    return ch;
  } };
}

test('⚠⚠ a rep with an empty profile inherits the head\'s qualifications, offer, niche and script — the grader sees them', async () => {
  const s = await fetchSellingContext(fakeAdmin(), 'rep');
  assert.ok(s.contextText.length > 500, 'was zero characters for every rep: ' + s.contextText.length);
  assert.strictEqual(s.qualifications, HEAD.qualifications, 'the qualification check sees the criteria');
  assert.ok(/not living paycheck to paycheck/.test(s.contextText));
  assert.ok(/Sober Living Homes Investing/.test(s.contextText) && /market research/.test(s.contextText));
  assert.ok(s.sources.some((x) => x.label === 'qualifications' && x.inherited_from === 'head'), 'the source says it was inherited: ' + JSON.stringify(s.sources));
});

test('⚠ field by field: a rep\'s own field with content wins; the empty ones still inherit', async () => {
  const s = await fetchSellingContext(fakeAdmin(), 'rep2');
  assert.ok(/My own offer wording/.test(s.contextText), 'own offer kept');
  assert.ok(!/market research/.test(s.contextText), 'the head\'s offer does not overwrite a rep\'s own');
  assert.strictEqual(s.qualifications, HEAD.qualifications, 'qualifications still inherited');
  const src = s.sources.find((x) => x.label === 'offer'); assert.strictEqual(src.inherited_from, null, 'own offer is not marked inherited');
});

test('the chain climbs to the head through an empty manager; the head itself inherits nothing; a fetch that fails returns empty', async () => {
  const s = await fetchSellingContext(fakeAdmin(), 'deep');
  assert.strictEqual(s.qualifications, HEAD.qualifications, 'inherits through the middle manager');
  const h = await fetchSellingContext(fakeAdmin(), 'head');
  assert.ok(h.sources.every((x) => !x.inherited_from));
  const bad = await fetchSellingContext({ from() { throw new Error('boom'); } }, 'rep');
  assert.strictEqual(bad.contextText, ''); assert.strictEqual(bad.qualifications, null);
});
