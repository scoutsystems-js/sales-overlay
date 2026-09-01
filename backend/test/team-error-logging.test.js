/**
 * A PROGRAMMER ERROR AND AN OPERATIONAL ONE MUST NOT LOOK THE SAME IN THE LOG.
 *
 * `/team/why-prose` had NEVER worked — it called an undefined `getAdminClient`
 * and threw a ReferenceError on its first line. It DID log, so "silently
 * swallowed" would be the wrong description: it logged `err.message` with no
 * stack, on a panel that rendered its own error state, and nobody reads logs
 * for a panel that looks like it is merely empty. It sat broken for weeks.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');

function logger() {
  const at = SRC.indexOf('function logTeamError');
  assert.ok(at > 0, 'logTeamError is missing — anchor stale');
  const end = SRC.indexOf('\n}', at);
  const src = SRC.slice(at, end + 2);
  assert.ok(src.length > 150 && src.length < 2000, 'slice must cover it: ' + src.length);
  const lines = [];
  const fake = { error: function () { lines.push(Array.prototype.slice.call(arguments).join(' ')); } };
  const fn = new Function('console', src + '\nreturn logTeamError;')(fake);
  return { fn, lines };
}

test('a ReferenceError or TypeError is flagged as a BUG and logs its stack', () => {
  const { fn, lines } = logger();
  fn('why-prose', new ReferenceError('getAdminClient is not defined'));
  fn('digest', new TypeError('cannot read properties of undefined'));
  assert.strictEqual(lines.length, 2);
  lines.forEach(l => {
    assert.ok(/PROGRAMMER ERROR/.test(l), 'must be marked as a bug: ' + l.slice(0, 80));
    /* ⚠ THE STACK IS THE POINT. The original logged only the message, so the one
       line that did reach the logs never said WHERE. */
    assert.ok(/at |routes|Function/.test(l), 'must include a stack: ' + l.slice(0, 120));
  });
});

test('an OPERATIONAL failure stays a one-line message — no stack, no bug label', () => {
  const { fn, lines } = logger();
  fn('overview', new Error('fetch failed: connection timeout'));
  assert.strictEqual(lines.length, 1);
  assert.ok(!/PROGRAMMER ERROR/.test(lines[0]), 'a database blip is not a bug');
  assert.ok(/connection timeout/.test(lines[0]), 'and still says what happened');
});

test('every catch in the file routes through it', () => {
  const code = SRC.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
                  .replace(/\/\*[\s\S]*?\*\//g, '');
  const calls = (code.match(/logTeamError\(/g) || []).length;
  /* ⚠ 14 -> 13 on 2026-09-01: GET /team/highlights was RETIRED and archived, so
     a log site legitimately went with it. The floor moves WITH the population and
     never below it — if it ever reaches the definition alone, this check is
     measuring nothing and should fail rather than pass. */
  assert.ok(calls >= 13, 'expected every log site plus the definition, found ' + calls);
  /* ⚠ The old shape must not come back — it is the one that hid a permanently
     broken endpoint for weeks. */
  assert.ok(!/console\.error\('\[team\] [a-z/-]+:', err\.message\)/.test(code),
    'a bare message-only log has returned');
});

test('the CLIENT message is unchanged — an internal name must never reach a browser', () => {
  /* ⚠ The generic 500 body is correct and deliberately untouched. The fix makes
     the SERVER loud, not the client chatty. */
  assert.ok(/res\.status\(500\)\.json\(\{ error: 'Failed to load/.test(SRC),
    'the generic client message must survive');
  assert.ok(!/res\.status\(500\)\.json\(\{ error: err\.message/.test(SRC),
    'the raw error must never be sent to the client');
});
