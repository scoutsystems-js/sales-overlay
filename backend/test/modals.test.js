/**
 * MODALS FOR THE USER-MANAGEMENT CONFIRMS — all 16, both pages.
 *
 * ⚠⚠ THE DANGEROUS PART IS THE CONTROL FLOW, NOT THE MARKUP. `confirm()` is
 * synchronous and returns a boolean; `scoutConfirm()` returns a PROMISE, and a
 * promise is ALWAYS TRUTHY. So a call site converted without `await`:
 *
 *     if (!scoutConfirm('Delete?')) return;    // never returns
 *
 * loses its guard entirely and runs the destructive action every time, throwing
 * nothing and reading correctly. It is the placeholder-is-a-valid-value trap on
 * a delete button. The first test below is the one that matters.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'web');
const MODAL_RAW = fs.readFileSync(path.join(WEB, 'js', 'scout-modal.js'), 'utf8');
/* ⚠ Comments stripped. The module's own prose says "textContent, never
   innerHTML" and explains the promise trap by quoting the broken call — so a
   raw scan reports the documentation of a rule as a violation of it. Third
   time this exact trap has fired in this codebase. */
const MODAL = MODAL_RAW.split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; })
  .join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

function code(rel) {
  return fs.readFileSync(path.join(WEB, rel), 'utf8')
    .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
const PAGES = ['dashboard.html', 'admin.html'];

test('⚠⚠ EVERY scoutConfirm/scoutPrompt CALL IS AWAITED', () => {
  PAGES.forEach(f => {
    const src = code(f);
    const re = /(.{0,12})\b(scoutConfirm|scoutPrompt)\s*\(/g;
    let m, n = 0;
    while ((m = re.exec(src)) !== null) {
      n++;
      assert.ok(/await\s*$/.test(m[1]) || /await\s*\(?\s*$/.test(m[1]),
        f + ': un-awaited ' + m[2] + ' — the promise is truthy, so the guard vanishes and the '
        + 'destructive action runs. Context: ' + JSON.stringify(m[1]));
    }
    assert.ok(n > 0, f + ' should call the modal helpers');
  });
});

test('no native confirm() or prompt() survives in either page', () => {
  PAGES.forEach(f => {
    const src = code(f);
    const natives = (src.match(/(?<!scout)\b(?:window\.)?(confirm|prompt)\s*\(/g) || []);
    assert.deepStrictEqual(natives, [], f + ' still has native dialogs: ' + natives.join(', '));
  });
});

test('both pages actually load the shared module — one implementation, not two', () => {
  PAGES.forEach(f => {
    const raw = fs.readFileSync(path.join(WEB, f), 'utf8');
      assert.ok(/<script src="\/js\/scout-modal\.js"><\/script>/.test(raw), f + ' must load it');
  });
  // and there is exactly ONE implementation
  assert.ok(/window\.scoutConfirm = /.test(MODAL) && /window\.scoutPrompt = /.test(MODAL));
  PAGES.forEach(f => {
    assert.ok(!/function scoutConfirm/.test(code(f)), f + ' must not define its own copy');
  });
});

/* ── the typed confirmation, which is the only friction before an irreversible act ── */

test('⚠⚠ THE TYPED CONFIRMATION SURVIVES, on both destructive flows', () => {
  const dash = code('dashboard.html'), adm = code('admin.html');
  assert.ok(/mustMatch: 'DELETE'/.test(dash), 'deleting a rep must still require DELETE typed');
  assert.ok(/matchCaseInsensitive: true/.test(dash), 'and stay case-insensitive, as before');
  assert.ok(/mustMatch: pv\.name/.test(adm), 'deleting a company must still require the exact name');
  assert.ok(!/matchCaseInsensitive/.test(adm.slice(adm.indexOf('mustMatch: pv.name'))),
    'the company name stays EXACT — loosening it would weaken the confirmation');
});

test('a mismatch does NOT close the dialog and does NOT proceed', () => {
  const fn = MODAL.slice(MODAL.indexOf('function accept()'), MODAL.indexOf('cancel.addEventListener'));
  assert.ok(fn.length > 200, 'accept() slice too short: ' + fn.length);
  assert.ok(/err\.style\.display = ''/.test(fn), 'it must show the mismatch message');
  /* It must return BEFORE close() — the whole point is that a mismatch leaves
     the dialog open rather than cancelling silently. */
  assert.ok(/input\.focus\(\);[\s\S]{0,80}return;/.test(fn), 'and stay open, returning before close()');
  assert.ok(fn.indexOf('return;') < fn.indexOf('close(v)'), 'the mismatch path must return first');
});

/* ── what a native dialog gave free and had to be re-implemented ────────── */

test('⚠ Escape cancels, focus is trapped, and focus RETURNS to the opener', () => {
  assert.ok(/e\.key === 'Escape'/.test(MODAL), 'Escape must cancel');
  assert.ok(/e\.key !== 'Tab'/.test(MODAL) && /shiftKey/.test(MODAL), 'Tab must be trapped both ways');
  /* A modal that swallows focus and never returns it strands a keyboard user
     on the page behind it. */
  assert.ok(/document\.contains\(opener\)[\s\S]{0,40}opener\.focus\(\)/.test(MODAL),
    'focus must return to whatever opened it');
  assert.ok(/role', 'dialog'/.test(MODAL) && /aria-modal/.test(MODAL), 'it must announce itself');
});

test('close() is idempotent — Escape and a click can race', () => {
  const fn = MODAL.slice(MODAL.indexOf('function close(result)'), MODAL.indexOf('function accept()'));
  assert.ok(fn.length > 150, 'close() slice too short: ' + fn.length);
  assert.ok(/if \(done\) return;/.test(fn), 'a second close must be a no-op');
  assert.ok(/removeEventListener\('keydown'/.test(fn), 'the key handler must be torn down');
});

test('text is inserted as textContent, never innerHTML', () => {
  /* Dialog bodies carry user-supplied values — an email, a company name. */
  assert.ok(!/innerHTML/.test(MODAL), 'the modal must never use innerHTML');
  assert.ok(/n\.textContent = text/.test(MODAL));
});

test('⚠ every colour token carries a fallback — admin.html defines none of them', () => {
  /* Measured: admin.html USES --bg-field / --border-strong / --accent / --bad
     and NOTHING defines them there (/css/style.css declares only --text and
     --muted). Without fallbacks the modal would render unstyled on exactly the
     page whose delete flows most need to look deliberate. */
  const css = MODAL.slice(MODAL.indexOf('var CSS = ['), MODAL.indexOf('function ensureCss'));
  assert.ok(css.length > 400, 'CSS slice too short: ' + css.length);
  const vars = css.match(/var\(--[a-z-]+[^)]*\)/g) || [];
  assert.ok(vars.length > 5, 'expected several tokens, found ' + vars.length);
  vars.forEach(v => assert.ok(/,/.test(v), 'token without a fallback: ' + v));
});
