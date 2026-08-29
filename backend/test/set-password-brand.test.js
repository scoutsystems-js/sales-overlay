/**
 * THE FIRST-TIME PASSWORD PAGE (Justin, 2026-08-29): add the login wordmark and
 * a show-password control. The rules line already existed and is pinned here so
 * a future edit cannot quietly drop it.
 *
 * ⚠ THIS IS THE FIRST SCREEN A NEW USER EVER SEES, so the customer-language
 * rule applies with full force: no mechanism, no internal names, and every
 * control says what pressing it DOES.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const P = path.join(__dirname, '..', 'web', 'set-password.html');
const SP = fs.readFileSync(P, 'utf8');
const LOGIN = fs.readFileSync(path.join(__dirname, '..', 'web', 'login.html'), 'utf8');

// ⚠ Comments first (line, then block) — this codebase archives removed code in
// place, so a raw match reports the prose ABOUT a rule as the rule itself.
function code(s) {
  return s.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
          .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
const CODE = code(SP);

test('the wordmark is the SAME asset and treatment as login, not a lookalike', () => {
  assert.ok(/<img[^>]*class="brand-img"[^>]*src="\/scout-wordmark\.png"/.test(CODE),
    'set-password must use the login wordmark image');
  assert.ok(LOGIN.indexOf('/scout-wordmark.png') !== -1, 'login lost its wordmark — anchor stale');
  // the native-width cap is what stops the browser upscaling the artwork
  assert.ok(/min\(96vw,\s*1038px\)/.test(CODE), 'lockup must cap at the asset native width');
});

test('the wordmark sits OUTSIDE both card states, so a dead link still shows it', () => {
  const lock = CODE.indexOf('class="brand-lockup"');
  const form = CODE.indexOf('id="setForm"');
  const dead = CODE.indexOf('id="linkProblem"');
  assert.ok(lock > 0 && form > 0 && dead > 0, 'anchors stale');
  assert.ok(lock < form && lock < dead, 'the lockup must precede BOTH states');
});

test('both password fields have a reveal control', () => {
  ['pw1', 'pw2'].forEach(id => {
    const re = new RegExp('aria-controls="' + id + '"');
    assert.ok(re.test(CODE), id + ' has no reveal control');
  });
  assert.strictEqual((CODE.match(/class="pw-toggle"/g) || []).length, 2,
    'exactly two reveal controls — one per field');
});

test('the reveal control is a real button, not a styled span', () => {
  const toggles = CODE.match(/<button[^>]*class="pw-toggle"[^>]*>/g) || [];
  assert.strictEqual(toggles.length, 2, 'reveal controls must be <button> elements');
  toggles.forEach(t => {
    // ⚠ a bare <button> defaults to submit; type is load-bearing
    assert.ok(/type="button"/.test(t), 'reveal control must be type="button": ' + t);
    assert.ok(/aria-pressed=/.test(t), 'reveal control must carry aria-pressed');
  });
});

test('the button is labelled with the ACTION, never the field state', () => {
  assert.ok(/>Show</.test(CODE), 'the control must read "Show" at rest');
  assert.ok(/'Hide' : 'Show'/.test(CODE), 'it must flip to "Hide" when revealed');
  // ⚠ "Password is hidden" describes the field and gets pressed the wrong way.
  assert.ok(!/Password is (hidden|visible)/i.test(CODE), 'label must not state field state');
});

test('the rules line stays beneath the field — it is not just a placeholder', () => {
  assert.ok(/class="hint">Minimum 10 characters\./.test(CODE),
    'the rule must render under the input, not only as a placeholder');
});

test('nothing on this page names a mechanism (customer-language rule)', () => {
  const banned = /\b(token|JWT|endpoint|API|Supabase|payload|null|undefined|hash)\b/i;
  // only the sentences a user can read: visible text nodes, not attributes/JS
  const body = CODE.slice(CODE.indexOf('<body'));
  const visible = (body.match(/>([^<>{}]{18,})</g) || [])
    .map(t => t.slice(1, -1).trim())
    .filter(t => /^[A-Z]/.test(t) && t.split(/\s+/).length >= 4 && !/[;={}]/.test(t));
  assert.ok(visible.length >= 3, 'found no customer sentences — the check is not measuring');
  visible.forEach(t => assert.ok(!banned.test(t), 'customer-facing text names a mechanism: ' + t));
});
