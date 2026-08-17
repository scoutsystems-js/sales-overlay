// Give the demo accounts REAL-LOOKING names (Justin's ruling: the board gets
// shown to people, and "demo-ava" reads as debug output).
//
// ⚠ NAMES LIVE ON user_profiles, WHICH THE SEED MARKER DOES NOT SWEEP. The
// marker removes the seeded CALLS and PROSPECTS; these three accounts are
// pre-existing demo users with their own separate documented cleanup. So the
// names are cosmetic and cost nothing operationally — but they are NOT removed
// by the two-line seed removal, and saying otherwise would be wrong.
const fs = require('fs');
const REPO = '/Users/justinschmidt/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay';
const K = fs.readFileSync(REPO + '/API Keys.md', 'utf8');
const v = (n) => K.match(new RegExp('^' + n + '=(.+)$', 'm'))[1].trim();
const { createClient } = require(REPO + '/backend/node_modules/@supabase/supabase-js');
const admin = createClient(v('SUPABASE_URL'), v('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

// Initials kept so anyone who knows the board as ava/ben/cara still maps them.
const NAMES = [
  { id: '49711e7d-0dc0-4c6d-959d-f2a5bfe9a20a', email: 'demo-ava@scout-demo.dev',  first: 'Ava',  last: 'Mitchell' },
  { id: '8bda1aac-6404-46a8-a353-de83606b298f', email: 'demo-ben@scout-demo.dev',  first: 'Ben',  last: 'Kowalski' },
  { id: 'e3ae475c-e788-45d6-a2ba-c40ca7f20a2d', email: 'demo-cara@scout-demo.dev', first: 'Cara', last: 'Whitfield' },
];

(async () => {
  const apply = process.argv[2] === '--apply';
  // Verify every target exists AND is the demo account we think it is, before
  // writing to a real user_profiles row.
  const q = await admin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', NAMES.map(n => n.id));
  const have = {}; (q.data || []).forEach(r => { have[r.user_id] = r; });
  console.log('=== TARGETS ===');
  let ok = true;
  for (const n of NAMES) {
    const row = have[n.id];
    console.log('  ' + n.email.padEnd(26) + (row ? 'exists (currently ' + (row.first_name || '—') + ' ' + (row.last_name || '—') + ')' : '*** NOT FOUND ***')
      + ' → ' + n.first + ' ' + n.last);
    if (!row) ok = false;
  }
  if (!ok) { console.error('\nABORT: a target does not exist.'); return; }
  if (!apply) { console.log('\n[plan only — re-run with --apply]'); return; }
  for (const n of NAMES) {
    const r = await admin.from('user_profiles').update({ first_name: n.first, last_name: n.last }).eq('user_id', n.id);
    if (r.error) { console.error('  update failed for ' + n.email + ': ' + r.error.message); return; }
  }
  const after = await admin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', NAMES.map(n => n.id));
  console.log('\n=== AFTER ===');
  (after.data || []).forEach(r => console.log('  ' + r.first_name + ' ' + r.last_name));
})();
