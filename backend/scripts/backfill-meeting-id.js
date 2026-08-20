/**
 * BACKFILL fathom_calls.meeting_id FROM FATHOM'S meeting_url.
 *
 * ⚠ WHY THIS NEEDS THE API AT ALL: meeting_url is not stored — we discarded it
 * at sync — so the id cannot be recovered from our own rows. It comes from the
 * same paginated /meetings call sync already makes; no new endpoint, no per-call
 * request. ~4 pages for Josh's 380.
 *
 * ⚠⚠ DATA-OP DISCIPLINE (standing): PRINT, VERIFY, WRITE THE VERIFIED IDS,
 * RECOUNT. Never a predicate re-evaluated at write time — the set can move
 * between the read and the write.
 *
 * ⚠ READ-ONLY ON TOKENS: uses the existing access token and NEVER refreshes.
 * Fathom's refresh tokens are single-use and rotate; a backfill that refreshed
 * could brick the connection it is reading from.
 *
 *   node scripts/backfill-meeting-id.js            # dry run — prints, writes nothing
 *   node scripts/backfill-meeting-id.js --write
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
const admin = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const WRITE = process.argv.includes('--write');
const API = 'https://api.fathom.ai/external/v1';

function meetingIdFromUrl(u) {
  if (typeof u !== 'string' || !u) return null;
  const m = u.match(/\/j\/(\d{9,})/);
  return m ? m[1] : null;
}

(async () => {
  const conns = await admin.from('fathom_connections')
    .select('user_id, access_token, expires_at, fathom_email').not('fathom_email', 'is', null);
  if (conns.error) throw new Error(conns.error.message);

  let totalSeen = 0, totalMatched = 0, totalWritten = 0;
  for (const c of conns.data) {
    if (new Date(c.expires_at) <= new Date()) {
      console.log('SKIP user ' + c.user_id.slice(0, 8) + ' — token expired; refusing to refresh in a backfill');
      continue;
    }
    // paginate the same way sync does
    let cursor = null, pages = 0, found = [];
    for (;;) {
      const u = new URL(API + '/meetings');
      u.searchParams.append('recorded_by[]', c.fathom_email);
      if (cursor) u.searchParams.append('cursor', cursor);
      const r = await fetch(u, { headers: { Authorization: 'Bearer ' + c.access_token, Accept: 'application/json' } });
      if (!r.ok) { console.log('  HTTP ' + r.status + ' — stopping for this user'); break; }
      const j = await r.json();
      const items = j.items || [];
      items.forEach((m) => {
        const id = meetingIdFromUrl(m.meeting_url);
        if (id && m.recording_id) found.push({ recording_id: String(m.recording_id), meeting_id: id });
      });
      pages++;
      cursor = j.next_cursor || null;
      if (!cursor || pages >= 60) break;   // Josh has ~380; 20 capped at 200
    }
    totalSeen += found.length;
    console.log('user ' + c.user_id.slice(0, 8) + ' — ' + pages + ' page(s), ' + found.length + ' meetings with a numeric id');
    if (!found.length) continue;

    // ⚠ VERIFY each target EXISTS and still needs it, before any write
    const ids = found.map((f) => f.recording_id);
    const rows = await admin.from('fathom_calls')
      .select('id, fathom_call_id, meeting_id')
      .eq('user_id', c.user_id).in('fathom_call_id', ids);
    if (rows.error) throw new Error(rows.error.message);
    const byCall = {}; rows.data.forEach((r) => { byCall[r.fathom_call_id] = r; });
    const targets = found
      .map((f) => ({ ...f, row: byCall[f.recording_id] }))
      .filter((f) => f.row && !f.row.meeting_id);
    totalMatched += targets.length;
    console.log('  ' + rows.data.length + ' of those exist here; ' + targets.length + ' need a meeting_id');
    targets.slice(0, 5).forEach((t) => console.log('    ' + t.row.id.slice(0, 8) + ' <- ' + t.meeting_id));
    if (targets.length > 5) console.log('    … and ' + (targets.length - 5) + ' more');

    if (!WRITE) continue;
    // ⚠ write the VERIFIED IDS, one by one — never a predicate at write time
    for (const t of targets) {
      const up = await admin.from('fathom_calls').update({ meeting_id: t.meeting_id }).eq('id', t.row.id);
      if (up.error) { console.error('    FAILED ' + t.row.id + ': ' + up.error.message); process.exit(1); }
      totalWritten++;
    }
  }

  console.log('\nseen ' + totalSeen + ' · needing backfill ' + totalMatched + ' · written ' + totalWritten);
  if (WRITE) {
    const rc = await admin.from('fathom_calls').select('id', { count: 'exact', head: true }).not('meeting_id', 'is', null);
    console.log('RECOUNT — rows with a meeting_id: ' + rc.count);
  } else {
    console.log('DRY RUN — nothing written. Re-run with --write.');
  }
})();
