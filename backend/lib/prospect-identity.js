// lib/prospect-identity.js — THE PROSPECT-NAME LIFT, step 1: capture the exact
// identity that already arrives, and STORE IT. Nothing here resolves, groups,
// merges, renames or moves a rate (Justin's ruling 2026-09-03, H700).
//
// Why this exists: the prospect grouping is built on grader names that are 87%
// first-name-only, and 70 of 83 one-word multi-call prospects turned out to be
// different people sharing a first name ("Anthony" holding four closes for one
// rep, counted as one). Fathom sends an EXACT identity on every call — the
// meeting's calendar_invitees list and, per transcript speaker,
// matched_calendar_invitee_email — and Scout read it only to find the closer.
// Storing it is the measurement of its coverage; the linking policy that will
// read it is recorded in CLAUDE.md §4b before anything is built on it.
//
// ⚠ RULING 1 (2026-08-11) is honoured, not reversed: the email is still never
// written onto a transcript TURN (transcript_stored). It is kept ONCE per call,
// per speaker, on fathom_calls.speaker_identities — which is what Justin ruled.
//
// ⚠ NULL vs [] is load-bearing ("write the null", H094):
//   NULL = not received / not captured (pre-062 rows, Zoom, a fetch that lacked
//          the field);  [] = received and empty.  A reader must never fold them.
'use strict';
var { isRejectedName } = require('./prospect-name');

function str(v) { return (typeof v === 'string' && v.trim()) ? v.trim() : null; }
function email(v) { var s = str(v); return s ? s.toLowerCase() : null; }

/* The meeting's invitee list as Fathom documents it (name, email, email_domain,
   is_external, matched_speaker_display_name). Entries without an email are
   dropped — an invitee we cannot identify is not an identity. */
function inviteesFromMeeting(m) {
  if (!m || !Array.isArray(m.calendar_invitees)) return null;
  var out = [];
  for (var i = 0; i < m.calendar_invitees.length; i++) {
    var inv = m.calendar_invitees[i];
    if (!inv || typeof inv !== 'object') continue;
    var e = email(inv.email);
    if (!e) continue;
    out.push({
      name:                         str(inv.name),
      email:                        e,
      email_domain:                 str(inv.email_domain),
      is_external:                  (typeof inv.is_external === 'boolean') ? inv.is_external : null,
      matched_speaker_display_name: str(inv.matched_speaker_display_name),
    });
  }
  return out;
}

/* The title's last "|" segment, verbatim (whitespace collapsed). A SEGMENT, not
   a name: 2–4 tokens, no digits, no "@", and not the shared rejection vocabulary
   (devices, meeting labels). "Check up With Dre | Sober Living Riches" stores the
   company name — on purpose: it is what the slot held, and the coverage report,
   not this function, is where it is judged. Nothing may overrule anything on it. */
function titleNameSegment(title) {
  var s = str(title);
  if (!s || s.indexOf('|') === -1) return null;
  var parts = s.split('|').map(function (p) { return p.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  if (!parts.length) return null;
  var seg = parts[parts.length - 1];
  if (/[0-9@]/.test(seg)) return null;
  var tokens = seg.split(' ');
  if (tokens.length < 2 || tokens.length > 4) return null;
  if (isRejectedName(seg)) return null;
  return seg;
}

/* One entry per speaker, encounter order, from the normalizer's pre-turns
   ({ display_name, email }). Once per call — never per turn (RULING 1). */
function speakerIdentitiesFrom(preTurns) {
  var out = [], idx = {};
  var arr = Array.isArray(preTurns) ? preTurns : [];
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i];
    if (!p || !p.display_name) continue;
    var k = p.display_name;
    if (!Object.prototype.hasOwnProperty.call(idx, k)) {
      idx[k] = out.length;
      out.push({ display_name: k, email: email(p.email), turns: 0 });
    }
    var row = out[idx[k]];
    row.turns++;
    if (!row.email && p.email) row.email = email(p.email);
  }
  return out;
}

/* The store. Scoped by id AND user_id like every other fathom_calls write in the
   worker; logs and returns on error — identity capture must never fail a grading. */
async function storeCallIdentities(admin, callId, userId, patch) {
  try {
    var r = await admin.from('fathom_calls').update(patch).eq('id', callId).eq('user_id', userId);
    if (r && r.error) console.warn('[prospect-identity] store failed for ' + callId + ': ' + r.error.message);
    return !(r && r.error);
  } catch (err) {
    console.warn('[prospect-identity] store threw for ' + callId + ': ' + ((err && err.message) || 'unknown'));
    return false;
  }
}

module.exports = {
  inviteesFromMeeting:   inviteesFromMeeting,
  titleNameSegment:      titleNameSegment,
  speakerIdentitiesFrom: speakerIdentitiesFrom,
  storeCallIdentities:   storeCallIdentities,
};
