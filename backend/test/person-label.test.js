const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* Rep pages were titled with the raw EMAIL — and with a bare UUID when the user
   was not in the loaded list, which is the worse half: a heading reading
   `a99f548b-…` names nobody. Swept BY CAPABILITY, not just the page Justin was
   looking at. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIVE = SRC.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Execute the real resolver rather than describing it.
const at = LIVE.indexOf('function personLabel(u)');
const personLabel = new Function('return (' + LIVE.slice(at, LIVE.indexOf('\n  }', at) + 4) + ')')();

test('⚠⚠ a person is named, never emailed and never id-ed', () => {
  assert.strictEqual(personLabel({ first_name: 'Godwin', last_name: 'Ona', email: 'g@x.com' }), 'Godwin Ona');
  assert.strictEqual(personLabel({ first_name: 'Godwin', email: 'g@x.com' }), 'Godwin');
  assert.strictEqual(personLabel({ display_name: 'Godwin Ona', email: 'g@x.com' }), 'Godwin Ona');
});

test('⚠ it FALLS BACK rather than rendering nothing', () => {
  // A name is preferred, but an email beats a blank heading.
  assert.strictEqual(personLabel({ email: 'g@x.com' }), 'g@x.com');
  assert.strictEqual(personLabel({}), null, 'nothing usable returns null so the caller can choose');
  assert.strictEqual(personLabel(null), null);
  assert.strictEqual(personLabel({ first_name: '  ', last_name: ' ', email: 'g@x.com' }), 'g@x.com',
    'whitespace-only names must not win over a real email');
});

test('⚠⚠ the page heading NEVER renders a raw user id', () => {
  assert.ok(!/heading = \(u \? u\.email : state\.viewingUserId\)/.test(LIVE),
    'the old email-or-UUID heading must be gone');
  assert.ok(/heading = personLabel\(u\) \|\| 'This rep'/.test(LIVE),
    'and its fallback must be words, not an id');
});

test('⚠ every surface that TITLES a person goes through the one resolver', () => {
  const uses = (LIVE.match(/personLabel\(/g) || []).length;
  assert.ok(uses >= 6, 'expected the definition plus five call sites, found ' + uses);
  assert.ok(!/title="Open ' \+ escapeHtml\(r\.email/.test(LIVE), 'rep tooltips must not use the email');
  assert.ok(!/escapeHtml\(u\.email \|\| u\.user_id\)/.test(LIVE), 'the user picker must not either');
});

test('⚠ the email SURVIVES where it is the subject, not a title', () => {
  // Deliberately untouched: the signed-in address, the Account field, and the
  // line UNDER a name in the members table. Those are not people-titles.
  assert.ok(/signedInEmail'\)\.textContent/.test(LIVE), 'the signed-in address must remain');
  assert.ok(/acctRow\('Email'/.test(LIVE), 'the Account email field must remain');
  assert.ok(/members-email/.test(LIVE), 'the members table still shows the email under the name');
});
