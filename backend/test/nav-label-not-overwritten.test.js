'use strict';
/* ⚠⚠⚠ THE LABEL SHIPPED, VERIFIED, AND NEVER APPEARED ON SCREEN (2026-09-01).
   The nav markup was changed from the raw signed-in email to "My Account". It
   deployed. A grep of the SERVED page found "My Account" and the change was
   reported as done. Justin then looked at the live page and saw his email.

   init() contained:
       document.getElementById('signedInEmail').textContent = cur.email;
   so the markup's label was replaced at boot, on every load.

   ⚠⚠ TWO CHECKS BOTH PASSED AND NEITHER COULD HAVE FAILED:
   (a) THE GREP ASKED THE WRONG QUESTION. "Is the label in the served page?" is
       not "is the email gone from the rendered nav?" — the first is about the
       markup, the second about what a browser ends up displaying. The correct
       assertion was always the ABSENCE of the old value, not the presence of the
       new one.
   (b) THE BROWSER HARNESS SUPPRESSES init(). The unauthenticated-iframe recipe
       works by writing the document with `init();` replaced — so ANY defect that
       lives inside init() is structurally invisible to it. The one line that
       broke this is the one line the harness removes.

   ⚠ THE RULE: a static label must be owned by the MARKUP OR by the SCRIPT, never
   half by each. This pins that nothing writes text into the nav's account link. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const CODE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('the nav account link is labelled in the markup', () => {
  assert.ok(/id="signedInEmail"[^>]*>My Account</.test(CODE),
    'the markup must carry the label');
});

test('⚠⚠ NOTHING WRITES TEXT INTO IT — that is what silently undid the relabel', () => {
  /* Every reference to the element, and what it does with it. A write to
     textContent / innerHTML / innerText is the defect; reading it, or touching
     classList / title, is fine. */
  const refs = CODE.split('\n')
    .map((l, i) => ({ n: i + 1, l: l.trim() }))
    .filter(x => /signedInEmail/.test(x.l));
  assert.ok(refs.length >= 2, 'stale anchor — the element id moved');

  const writes = CODE.match(/getElementById\('signedInEmail'\)\s*\.\s*(textContent|innerHTML|innerText)\s*=/g) || [];
  assert.deepStrictEqual(writes, [],
    'something writes text into the account link — the markup label will be replaced at boot');

  /* the indirect form: `var x = getElementById('signedInEmail')` then `x.textContent = ...` */
  const via = CODE.match(/(\w+)\s*=\s*document\.getElementById\('signedInEmail'\)/g) || [];
  via.forEach(m => {
    const name = m.match(/(\w+)\s*=/)[1];
    const bad = new RegExp('\\b' + name + '\\s*\\.\\s*(textContent|innerHTML|innerText)\\s*=');
    assert.ok(!bad.test(CODE),
      'the account link is written to via `' + name + '` — same defect, one variable removed');
  });
});

test('⚠ the signed-in address is still reachable — the relabel must not lose it', () => {
  /* The raw email was the only place on screen naming the account. Losing it
     outright would be a real cost on a shared machine, so it moved to the title
     rather than disappearing. */
  assert.ok(/em\.title = 'Signed in as ' \+ cur\.email/.test(CODE),
    'the signed-in address must still be discoverable from the nav');
});
