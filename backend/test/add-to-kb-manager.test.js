/**
 * ADD TO KNOWLEDGE BASE — MANAGERS AND ABOVE (Justin, step 2, 2026-08-29).
 *
 * ⚠⚠ THIS IS NOT A REVERSAL OF THE 2026-08-18 REMOVAL, and the distinction is
 * the whole justification. That deleted a REP button duplicating auto-harvest —
 * 313 moments filed automatically, ZERO added by hand. A MANAGER marking the
 * standard is a different act: it is the correction mechanism, and there was no
 * way to do it at all.
 *
 * ⚠⚠ AND THE FEATURE WOULD HAVE WRITTEN INTO A VOID WITHOUT ITS COMPANION FIX.
 * The section library — the only surface that shows call moments to a rep —
 * filtered `uploaded_by = userId`. A promoted moment carries `uploaded_by` = THE
 * MANAGER, so no rep could ever have seen one. Complete and unreachable.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildMomentRow, resolveEntryTarget } = require('../lib/kb-entry');
const { selectLibraryMoments } = require('../lib/section-library');
const { kbReadRowVisible } = require('../lib/kb-scope');

const WEB = path.join(__dirname, '..', 'web');
const LIVE = fs.readFileSync(path.join(WEB, 'dashboard.html'), 'utf8')
  .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
function code(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/* ── where a mark lands ────────────────────────────────────────────────── */

test('a manager marking a REP\'s moment lands at TEAM scope, keyed to their team', () => {
  const t = resolveEntryTarget({ role: 'manager', p_user_id: 'mgr', p_admin_id: 'mgr' }, 'rep');
  assert.strictEqual(t.ok, true);
  assert.strictEqual(t.target.scope, 'team');
  assert.strictEqual(t.target.team_owner_id, 'mgr', 'the team key');
  /* ⚠ uploaded_by keeps TRUE PROVENANCE — team_owner_id exists precisely so a
     promotion does not have to overwrite who added it. */
  assert.strictEqual(t.target.uploaded_by, 'mgr');
});

test('a plain rep may not mark someone else\'s moment', () => {
  const t = resolveEntryTarget({ role: 'user', p_user_id: 'rep', p_admin_id: 'mgr' }, 'other');
  assert.strictEqual(t.ok, false);
});

/* ── the companion fix: a rep can actually SEE it ──────────────────────── */

test('⚠⚠ a TEAM moment is visible to a rep on that team, and to nobody else', () => {
  const row = { scope: 'team', uploaded_by: 'mgr', team_owner_id: 'mgr' };
  assert.strictEqual(kbReadRowVisible(row, { p_user_id: 'rep', p_admin_id: 'mgr' }), true);
  assert.strictEqual(kbReadRowVisible(row, { p_user_id: 'x', p_admin_id: 'other-mgr' }), false);
  /* a rep with no team must never match a null key */
  assert.strictEqual(kbReadRowVisible(row, { p_user_id: 'x', p_admin_id: null }), false);
});

test('⚠⚠ the library query no longer filters uploaded_by = self — that made it unreachable', () => {
  const src = code('routes/me.js');
  const at = src.indexOf('out.library = []');
  const lane = src.slice(at, src.indexOf('return out;', at));
  assert.ok(lane.length > 400, 'lane slice too short: ' + lane.length);
  assert.ok(/team_owner_id\.eq\.' \+ adminId/.test(lane), 'team rows must be candidates');
  assert.ok(/kbReadRowVisible\(r, callerScope\)/.test(lane), 'and the SHARED predicate decides');
  assert.ok(!/\.eq\('uploaded_by', userId\)/.test(lane),
    'the self-only filter is what made a promoted moment invisible');
});

/* ── the note ──────────────────────────────────────────────────────────── */

test('⚠ the note is OPTIONAL and, when present, LEADS the stored content', () => {
  /* Measured on 939 good closer moments: 100% carry an observation, only 15%
     contain any reasoning — and an observation is sometimes CRITICAL of the
     moment it describes. The note is what makes it a standard, so it goes first. */
  const withNote = buildMomentRow({
    highlight: { section: 'objection', speaker: 'CLOSER', quote: 'q', observation: 'o' },
    target: { scope: 'team', team_owner_id: 'mgr', uploaded_by: 'mgr' },
    fathomCallId: 'c1', source: 'manual_add', note: 'he isolates it first',
  });
  assert.ok(withNote.content.indexOf('Why this is the standard: he isolates it first') === 0,
    'the note must lead the content, got: ' + withNote.content.slice(0, 60));
  assert.strictEqual(withNote.metadata.note, 'he isolates it first');

  const without = buildMomentRow({
    highlight: { section: 'objection', speaker: 'CLOSER', quote: 'q', observation: 'o' },
    target: { scope: 'team', team_owner_id: 'mgr', uploaded_by: 'mgr' },
    fathomCallId: 'c1', source: 'manual_add',
  });
  assert.ok(without.content.indexOf('During objection') === 0, 'no note → unchanged shape');
  assert.strictEqual(without.metadata.note, null);
});

test('⚠ CANCELLING is not the same as adding without a note', () => {
  const src = LIVE.slice(LIVE.indexOf('async function addMomentToKb'));
  assert.ok(/if \(note === null\) return;/.test(src),
    'a cancelled prompt must abort, not add a note-less moment');
  assert.ok(/note: note \|\| ''/.test(src), 'an empty string is a real "no note"');
});

/* ── what the rep sees ─────────────────────────────────────────────────── */

test('⚠⚠ the note reaches the rep and is NOT attributed', () => {
  /* Justin's ruling on the related case: coaching reads "here's what you should
     try next time", NOT "this is how your manager handles it". */
  const out = selectLibraryMoments([{
    source_section: 'objection', created_at: '2026-08-29T00:00:00Z',
    metadata: { speaker: 'CLOSER', speaker_verified: true, quote: 'q', note: 'isolate first' },
  }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].note, 'isolate first');

  /* ⚠ ITS OWN CLASS (④b-1, 2026-09-02). `.sec-note` is the section page's italic caveat;
     the manager's note once shared the name and the browser merged the two designs. The
     assertion is scoped to the note's render, not the whole page, so the caveat's class
     cannot satisfy it. */
  const noteAt = LIVE.indexOf('var noteHtml');
  assert.ok(noteAt !== -1, 'the note render must exist');
  assert.ok(/class="sec-moment-note"/.test(LIVE.slice(noteAt, noteAt + 400)), 'the note must render with its OWN class');
  assert.ok(!/your manager|added by|marked by/i.test(
    LIVE.slice(LIVE.indexOf('var noteHtml'), LIVE.indexOf('var noteHtml') + 400)),
    'it must not name who marked it');
});

/* ── the gate and the placement ────────────────────────────────────────── */

test('the button is gated on ROLE, and appears wherever a moment is shown', () => {
  assert.ok(/function canMarkStandard\(\)/.test(LIVE));
  assert.ok(/r === 'manager' \|\| r === 'owner'/.test(LIVE), 'managers and above only');
  assert.ok(/if \(canMarkStandard\(\) && h\.id\)/.test(LIVE),
    'the gate is role-based, not per-call-site');
  /* ⚠ highlightEntryHtml renders BOTH the Call Highlights timeline and the
     expanded section cards. Last time the button was gated per call site and
     ended up on only ONE of them — the section cards, never the timeline,
     which is the surface Justin describes. */
  assert.ok(/kbBtn \+ '<\/div>'/.test(LIVE) || /handlingBadge \+ kbBtn/.test(LIVE),
    'the button must be in the row markup');
});

test('the saved-set lookup is actually CALLED, and only for someone who can add', () => {
  assert.ok(/if \(canMarkStandard\(\)\) loadSavedMoments\(callId\);/.test(LIVE),
    'defining it is not calling it');
});

test('it sends IDS ONLY — nothing rendered is trusted on write', () => {
  const src = LIVE.slice(LIVE.indexOf('async function addMomentToKb'));
  const body = src.slice(src.indexOf('JSON.stringify'), src.indexOf('});', src.indexOf('JSON.stringify')));
  assert.ok(/fathom_call_id/.test(body) && /highlight_id/.test(body));
  assert.ok(!/quote|observation|speaker/.test(body), 'the server re-reads the row; do not send its content');
});
