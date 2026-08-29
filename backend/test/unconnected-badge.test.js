/**
 * WHO HAS NOT CONNECTED A RECORDING SOURCE (Justin, ruled 2026-08-28:
 * OPTION 3, PER PERSON).
 *
 * A rep who never connected looked exactly like one having a quiet week, so a
 * manager's most actionable fact was invisible. Measured on the live board when
 * this shipped: 2 of 9 active reps unconnected, both with zero calls.
 *
 * ⚠ THE RULING IS THE DISMISSAL, and it is what these tests exist to hold:
 * gone for everyone the manager has been told about, back the moment someone
 * NEW is unconnected. Per badge in either direction fails — "never again"
 * means a rep onboarded in three weeks never triggers it, and "until tomorrow"
 * nags until it is ignored.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

// Drive the REAL shipped functions, not a reimplementation.
function api(perRep, stored) {
  const store = { k: stored === undefined ? null : JSON.stringify(stored) };
  const names = ['unconnectedReps', 'unconnectedDismissed', 'unconnectedToShow', 'unconnectedBadgeHtml'];
  const src = names.map(n => {
    const at = HTML.indexOf('function ' + n + '(');
    assert.ok(at > 0, n + ' is missing — anchor stale');
    const end = HTML.indexOf('\n  }', at);
    const s = HTML.slice(at, end + 4);
    assert.ok(s.length > 60, 'slice must cover ' + n + ': ' + s.length);
    return s;
  }).join('\n');
  const ls = { getItem: k => store[k], setItem: (k, v) => { store[k] = v; } };
  return new Function('state', 'localStorage', 'escapeHtml',
    'var UNCONNECTED_KEY="k";' + src +
    '\nreturn { reps: unconnectedReps, show: unconnectedToShow, html: unconnectedBadgeHtml };'
  )({ teamOverview: { per_rep: perRep } }, ls, String);
}

const TWO = [
  { user_id: 'a', display_name: 'Daniel', active: true, connected: false },
  { user_id: 'b', display_name: 'Nathan', active: true, connected: false },
  { user_id: 'c', display_name: 'Josh', active: true, connected: true },
];

test('it names the people who have not connected', () => {
  const html = api(TWO).html();
  assert.ok(/Daniel/.test(html) && /Nathan/.test(html), 'both unconnected reps must be named');
  assert.ok(!/Josh/.test(html), 'a connected rep must not appear');
  assert.ok(/cannot be graded|can.{0,3}t be graded|none of their calls/i.test(html),
    'it must say what the consequence is');
});

test('⚠ A FULLY CONNECTED TEAM SEES NOTHING', () => {
  /* ⚠ This is an EXCEPTION surface, not a data surface. "0 people need your
     attention" is furniture, and a banner that is always present trains people
     to stop seeing it — which is why the zero-is-a-measurement rule does not
     apply here. */
  assert.strictEqual(api([{ user_id: 'c', display_name: 'Josh', active: true, connected: true }]).html(), '');
  assert.strictEqual(api([]).html(), '');
});

test('⚠⚠ DISMISSAL IS PER PERSON — dismissed stay gone, someone NEW brings it back', () => {
  assert.strictEqual(api(TWO, ['a', 'b']).html(), '', 'people already dismissed must not return');

  const plusNew = TWO.concat([{ user_id: 'd', display_name: 'Priya', active: true, connected: false }]);
  const html = api(plusNew, ['a', 'b']).html();
  assert.ok(/Priya/.test(html), 'someone newly unconnected must bring the badge back');
  assert.ok(!/Daniel/.test(html) && !/Nathan/.test(html),
    'and the people already dismissed must stay dismissed');
});

test('dismissal PRUNES to the currently unconnected, so a later disconnect counts as new', () => {
  const src = HTML.slice(HTML.indexOf('function dismissUnconnected('), HTML.indexOf('function unconnectedBadgeHtml('));
  assert.ok(src.length > 100, 'dismissUnconnected is missing — anchor stale');
  /* ⚠ Without the prune, someone who connects and later disconnects stays
     dismissed FOREVER — the "never again" failure in miniature, and invisible. */
  assert.ok(/unconnectedReps\(\)/.test(src),
    'dismiss must write the CURRENTLY unconnected set, not append to history');
});

test('a deactivated person is never chased, and an UNKNOWN state never fires', () => {
  assert.strictEqual(api([{ user_id: 'e', display_name: 'Gone', active: false, connected: false }]).html(), '',
    'deactivated people are not chased');
  /* ⚠ `connected === false`, never `!connected`: a missing field means the
     server could not tell us, and a badge that accuses a real person by name
     must not fire on an unknown. */
  assert.strictEqual(api([{ user_id: 'g', display_name: 'Unknown', active: true }]).html(), '',
    'an absent connection state must not be read as unconnected');
});

test('the server reports connection state, and degrades to CONNECTED on failure', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-analytics.js'), 'utf8');
  const code = src.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
                  .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/connected: connectedSet\[id\] === true/.test(code), 'per_rep must carry `connected`');
  /* ⚠ BOTH TABLES. Fathom lives in fathom_connections and everything else in
     call_connections; checking one would report most of the platform as
     unconnected. */
  assert.ok(/from\('fathom_connections'\)/.test(code) && /from\('call_connections'\)/.test(code),
    'both connection tables must be consulted');
  // on a read failure nobody is accused
  assert.ok(/connErr[\s\S]{0,200}connectedSet\[id\] = true/.test(code),
    'a lookup failure must degrade to CONNECTED, never accuse someone by name');
});
