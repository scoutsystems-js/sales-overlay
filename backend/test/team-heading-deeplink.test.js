/**
 * THE TEAM HEADING ON A DEEP LINK (fixed 2026-08-29).
 *
 * It read "My team" when reached via the Team page and the bare word "Team" on
 * a refresh or a pasted link. The cause is the lane the name came from: the
 * label was resolved from the team-OVERVIEW payload, which the sub-pages
 * (#team-recs, #team-needs-work, #team-members, #team-objections) never load,
 * and the owner-only `teams` array, which a MANAGER never receives.
 *
 * The fix moves the name onto /team/context — the one lane every team surface
 * loads — so the heading no longer depends on which lane a page happens to
 * fetch. Same shape as board_size: the payload carries what the view renders.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const TEAM = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');

// Extract the real shipped resolver and run it, rather than reimplementing it.
function resolver(state) {
  const at = HTML.indexOf('function teamLabelForSelection()');
  assert.ok(at > 0, 'teamLabelForSelection is missing — anchor stale');
  const end = HTML.indexOf('\n  }', at);
  const src = HTML.slice(at, end + 4);
  assert.ok(src.length > 300 && src.length < 3000, 'slice must cover the function: ' + src.length);
  // eslint-disable-next-line no-new-func
  return new Function('state', src + '\n return teamLabelForSelection();')(state);
}

test('the server sends the caller\'s own company name on the context lane', () => {
  assert.ok(/ctx\.my_team_label\s*=/.test(TEAM), '/team/context must carry my_team_label');
  // it must NOT be scoped to the picked team: context is what restores the pick
  const at = TEAM.indexOf('ctx.my_team_label');
  const line = TEAM.slice(at, TEAM.indexOf('\n', at));
  assert.ok(/req\.user\.id/.test(line), 'the label must key on the CALLER, not the selection');
  assert.ok(!/resolveTeam/.test(line), 'context must not depend on the resolved team');
});

test('a MANAGER on a deep link gets their company name, not the bare word Team', () => {
  // no `teams` array (owners only), no overview payload (sub-pages skip it)
  const label = resolver({ teamContext: { my_team_label: 'Sober Living Riches', teams: null }, teamSelected: null });
  assert.strictEqual(label, 'Sober Living Riches');
});

test('an OWNER still gets the picked company, never their own', () => {
  const ctx = {
    my_team_label: 'Scout Systems',
    teams: [
      { key: 'me', label: 'Scout Systems', is_self: true },
      { key: 'other', label: 'Sober Living Riches', is_self: false },
    ],
  };
  assert.strictEqual(resolver({ teamContext: ctx, teamSelected: 'other' }), 'Sober Living Riches');
  assert.strictEqual(resolver({ teamContext: ctx, teamSelected: null }), 'Scout Systems');
});

test('a selection that has not resolved does NOT fall back to the caller\'s own name', () => {
  /* THE ONE CASE THAT MUST NOT BE "HELPFUL": an owner viewing another company
     whose teams array has not arrived yet. Titling that page with the owner's
     OWN company is the two-panels-different-populations failure — one company's
     numbers under another company's name. Better to fall through and render
     nothing than to render the wrong name confidently. */
  const label = resolver({ teamContext: { my_team_label: 'Scout Systems', teams: null }, teamSelected: 'other' });
  assert.strictEqual(label, null);
});

test('no context yet: returns null so the caller can fall through', () => {
  assert.strictEqual(resolver({ teamContext: null, teamSelected: null }), null);
  assert.strictEqual(resolver({ teamContext: { teams: [] }, teamSelected: null }), null);
});

// ── the same family, found by sweeping for viewer-context fallbacks ─────────
function membersScope(state) {
  const at = HTML.indexOf('function teamMembersScope()');
  assert.ok(at > 0, 'teamMembersScope is missing — anchor stale');
  const end = HTML.indexOf('\n  }', at);
  const src = HTML.slice(at, end + 4);
  assert.ok(src.length > 300 && src.length < 3000, 'slice must cover the function: ' + src.length);
  // eslint-disable-next-line no-new-func
  return new Function('state', src + '\n return teamMembersScope();')(state);
}

test('Manage Members never falls back to the VIEWER\'s own team while another is selected', () => {
  /* The first paint happens before the overview lane lands. With a company
     selected, falling back to state.me.user_id renders the viewer's OWN
     members under the other company's name. */
  const r = membersScope({
    teamOverview: null, teamSelected: 'other-company',
    me: { user_id: 'viewer' },
    users: [{ user_id: 'x', managed_by: 'viewer' }],
  });
  assert.strictEqual(r.key, null, 'an unresolved company must resolve to nothing');
  assert.deepStrictEqual(r.members, [], 'and must list nobody');
});

test('a MANAGER on their own team still resolves — the fix must not blank the common case', () => {
  const r = membersScope({
    teamOverview: null, teamSelected: null,
    me: { user_id: 'mgr' },
    users: [{ user_id: 'rep', managed_by: 'mgr' }, { user_id: 'other', managed_by: 'someone' }],
  });
  assert.strictEqual(r.key, 'mgr');
  assert.strictEqual(r.members.length, 1, 'their own reps still list');
});

test('once the payload lands, the payload wins over the viewer', () => {
  const r = membersScope({
    teamOverview: { team: { key: 'other-company' } }, teamSelected: 'other-company',
    me: { user_id: 'viewer' },
    users: [{ user_id: 'a', managed_by: 'other-company' }, { user_id: 'b', managed_by: 'viewer' }],
  });
  assert.strictEqual(r.key, 'other-company');
  assert.strictEqual(r.members.length, 1);
});
