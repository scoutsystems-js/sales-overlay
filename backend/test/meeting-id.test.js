/**
 * THE NUMERIC MEETING ID — the exact key for calendar matching.
 *
 * ⚠⚠ THIS EXISTS BECAUSE I GOT THE ANSWER WRONG FIRST. I reported that Fathom
 * calls "carry no meeting URL", having checked what we STORE rather than what
 * the API RETURNS. A live probe showed `meeting_url` present on 10/10 of Josh's
 * meetings, every one a *.zoom.us link containing /j/<numeric id> — so Fathom
 * calls were exactly joinable all along and the heuristic is the edge case.
 *
 * ⚠ THE ID IS REUSED. Recurring series and personal meeting rooms share one
 * numeric id across many meetings — Josh's own parked call is "Josh's Personal
 * Meeting Room" — so every join must key on meeting_id + DATE.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FATHOM = fs.readFileSync(path.join(__dirname, '..', 'routes', 'fathom.js'), 'utf8');
const ZOOM = fs.readFileSync(path.join(__dirname, '..', 'lib', 'zoom-client.js'), 'utf8');

function meetingIdFromUrl(u) {
  const at = FATHOM.indexOf('function meetingIdFromUrl');
  const end = FATHOM.indexOf('\n}', at) + 2;
  const src = FATHOM.slice(at, end);
  assert.ok(src.length > 80 && src.length < 900, 'slice suspicious: ' + src.length);
  return new Function(src + '; return meetingIdFromUrl;')()(u);
}

test('⚠ the id is extracted from a real Zoom join URL shape', () => {
  assert.strictEqual(meetingIdFromUrl('https://us06web.zoom.us/j/81234567890'), '81234567890');
  assert.strictEqual(meetingIdFromUrl('https://us06web.zoom.us/j/81234567890?pwd=abc'), '81234567890');
  assert.strictEqual(meetingIdFromUrl('https://acme.zoom.us/j/9876543210#success'), '9876543210');
});

test('⚠⚠ it REFUSES rather than guessing — a wrong id mispairs an event', () => {
  [null, undefined, '', 'not a url', 'https://meet.google.com/abc-defg-hij',
   'https://us06web.zoom.us/rec/share/tokenonly',
   'https://us06web.zoom.us/j/1234'           // too short to be a meeting id
  ].forEach((u) => assert.strictEqual(meetingIdFromUrl(u), null,
    'must return null, not a guess: ' + JSON.stringify(u)));
});

test('⚠ BOTH providers populate it — one-sided coverage is a silent half-feature', () => {
  assert.ok(/meeting_id:\s*meetingIdFromUrl\(m\.meeting_url\)/.test(FATHOM),
    'Fathom must map it out of meeting_url');
  assert.ok(/meeting_id:\s*\(m\.id === 0 \|\| m\.id\)/.test(ZOOM),
    'Zoom must map its numeric id');
});

test('⚠⚠ Zoom keeps the UUID **and** the numeric id — they are different keys', () => {
  assert.ok(/fathom_call_id:\s*String\(m\.uuid\)/.test(ZOOM),
    'the instance uuid must remain — it is what the recordings API is re-queried by');
  assert.ok(/meeting_id:/.test(ZOOM),
    'and the numeric id is what a calendar invite carries');
});

test('⚠ the schema keys on meeting_id + DATE, never the id alone', () => {
  const mig = fs.readFileSync(path.join(__dirname, '..', 'migrations', '041_meeting_id.sql'), 'utf8');
  assert.ok(/meeting_id text/.test(mig), 'the column must exist');
  assert.ok(/\(user_id, meeting_id, call_date\)/.test(mig),
    'the index must include call_date — a personal meeting room reuses one id '
    + 'across every meeting held in it');
});
