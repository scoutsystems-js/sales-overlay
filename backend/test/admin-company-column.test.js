/* THE ADMIN COMPANY COLUMN (2026-08-30).
   Two symptoms, one cause: the column rendered `managed_by` — a FOREIGN KEY —
   where a business fact belongs. So it labelled companies by the MANAGER'S EMAIL,
   and a company HEAD (who has no managed_by, because nobody manages the head)
   read as "None — single user".

   ⚠ THE GROUPING WAS NEVER WRONG, and that was established before the label was
   touched: joshua@soberlivingriches.com has 8 reps and team_name "Sober Living
   Riches" and is bucketed correctly. A label fix on a wrong grouping would have
   hidden a real defect; here there was none to hide. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');

function build(companies) {
  const from = HTML.indexOf('function companyOf(u)');
  const to = HTML.indexOf('// Save-on-change for role');
  assert.ok(from !== -1 && to > from, 'company column functions not found');
  const src = HTML.slice(from, to);
  // ⚠ a backwards or truncated slice silently tests the empty string
  assert.ok(src.length > 1500 && src.length < 6000, 'slice must cover the block: ' + src.length);
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  return new Function('escapeHtml', 'companiesArray', 'usersArray', 'roleLabel', 'fieldControl',
    src + '; return { ctrl: managedByControlHtml, label: managedByLabel };')(
    escapeHtml, companies, [], (r) => r,
    (u, field, val, opts) => '<select data-val="' + val + '">' + opts + '</select>');
}

const COMPANIES = [{ key: 'josh-id', name: 'Sober Living Riches' }, { key: 'scout-id', name: 'Scout Systems' }];
const HEAD = { user_id: 'josh-id', managed_by: null, role: 'manager' };
const REP = { user_id: 'rep1', managed_by: 'josh-id', role: 'user' };
const SOLO = { user_id: 'solo1', managed_by: null, role: 'user' };
const strip = (h) => h.replace(/<[^>]*>/g, '').trim();

test('⚠⚠ a company HEAD reads as their COMPANY, not "single user"', () => {
  const f = build(COMPANIES);
  assert.strictEqual(strip(f.ctrl(HEAD, [])), 'Sober Living Riches',
    'the person who RUNS the company was being told they are in none of them — a head has '
    + 'no managed_by, and the column printed that raw column');
  assert.strictEqual(strip(f.label(HEAD)), 'Sober Living Riches', 'the read-only cell too');
});

test('⚠ a HEAD gets a STATIC label — the data model forbids the choice', () => {
  const f = build(COMPANIES);
  const out = f.ctrl(HEAD, []);
  assert.ok(out.indexOf('<select') === -1,
    'this control writes managed_by, and no_self_manage forbids managed_by = self. A dropdown '
    + 'here would present a choice that cannot be made.');
  assert.ok(out.indexOf('option value="josh-id"') === -1, 'and never offers the head their own company');
});

test('⚠⚠ options are COMPANY NAMES, never manager emails', () => {
  const out = build(COMPANIES).ctrl(REP, [{ user_id: 'josh-id', email: 'joshua@soberlivingriches.com', role: 'manager' }]);
  assert.ok(/Sober Living Riches/.test(out), 'the company name is the label');
  assert.ok(!/@/.test(out),
    'nobody outside the build knows which email is which company — making an admin hold that '
    + 'mapping is asking them to know something the product already knows');
  assert.ok(/value="josh-id" selected/.test(out),
    'the VALUE stays the head id, because that is what managed_by stores');
});

test('⚠ "None — single user" survives as a REAL state', () => {
  const f = build(COMPANIES);
  assert.ok(/None — single user/.test(f.ctrl(SOLO, [])),
    'an unaffiliated user genuinely has no company — that is a fact, not the head bug');
  assert.strictEqual(strip(f.label(SOLO)), '— none');
});

test('⚠ it falls back to managers only when the grouped payload is missing', () => {
  const out = build([]).ctrl(REP, [{ user_id: 'josh-id', email: 'joshua@x.com', role: 'manager' }]);
  assert.ok(/joshua@x\.com/.test(out),
    'an empty picker is worse than an email — the fallback exists so this can never render blank');
});
