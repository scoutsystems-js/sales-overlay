// lib/prospect-link.js — LINKING (Justin's approved policy, 2026-09-03, H705).
//
// THE POLICY, recorded in CLAUDE.md §4b before it was built:
//   Path 1 — exactly ONE external invitee email on the call → the prospect keyed by
//            that email. The only exact path.
//   Path 2 — a Fathom title segment, or a two-word Zoom display name, whose FIRST
//            WORD equals the resolved first name → keyed by the full name. Second
//            path, never the first.
//   Path 3 — everything else: today's one-word key, unchanged (the splitting pass
//            can re-run over it until the CRM lands).
//   SILENCE at every step: placeholders, devices, a company name, a mismatched
//   first name produce NO link on that path — the next path is tried, and the last
//   is today's behaviour, never a guess.
//
// The husband on his wife's account: the invitee is Mary, the speaker is John. Path 1
// requires the ONE external invitee's name to agree with the resolved first name — a
// display name is whose ACCOUNT it is, not who is talking — so it is silent; path 2
// then needs a title or display name starting with "John"; failing that, path 3.
// Two external invitees (the couple): never path 1; path 2 by the title if it names
// the speaker; else path 3.
//
// chooseLink is pure and total. attachProspect does I/O and never throws.
'use strict';
var { nameKey } = require('./prospect-entity');
var { titleNameSegment, hasPlaceholderToken } = require('./prospect-identity');
var { isRejectedName } = require('./prospect-name');

var PATHS = { HUMAN: 'human', INVITEE_EMAIL: 'invitee_email', TITLE_NAME: 'title_name', DISPLAY_NAME: 'display_name', RESOLVED_NAME: 'resolved_name' };

function firstWord(s) { return (typeof s === 'string' && s.trim()) ? s.trim().split(/\s+/)[0].toLowerCase().replace(/[.,'"]/g, '') : null; }
function fullNameOk(s) {
  if (typeof s !== 'string') return null;
  var seg = s.replace(/\s+/g, ' ').trim();
  if (!seg || /[0-9@]/.test(seg)) return null;
  var toks = seg.split(' ');
  if (toks.length < 2 || toks.length > 4) return null;
  if (isRejectedName(seg)) return null;
  if (hasPlaceholderToken(toks)) return null;   // "Anthony NoLastname" is not a person
  return seg;
}

/* input: { resolvedName, invitees: [{name,email,is_external}], titleSegment, source,
            prospectDisplayNames: [display names labelled PROSPECT], title }
   → { path, email|null, display_name, name_key } — never null: path 3 is today's key.
     When even the resolved name is unusable → { path: null } (no attach, as today). */
function chooseLink(input) {
  var o = input || {};
  var resolved = (typeof o.resolvedName === 'string' && o.resolvedName.trim()) ? o.resolvedName.trim() : null;
  var rFirst = firstWord(resolved);
  var rKey = nameKey(resolved);
  /* ── path 0 · THE HUMAN PATH (H707): a person's rename on the call, above the exact path —
       a person on the call knows more than an invite list. */
  var human = (typeof o.humanName === 'string' && o.humanName.trim()) ? o.humanName.replace(/\s+/g, ' ').trim() : null;
  if (human && nameKey(human)) return { path: PATHS.HUMAN, email: null, display_name: human, name_key: nameKey(human) };
  if (!rKey) return { path: null, email: null, display_name: null, name_key: null, reason: 'no_resolved_name' };
  // ── path 1 · exactly one external invitee whose name agrees with the speaker ──
  var ext = (Array.isArray(o.invitees) ? o.invitees : []).filter(function (i) { return i && i.is_external === true && typeof i.email === 'string' && i.email; });
  if (ext.length === 1) {
    var inv = ext[0];
    var invFirst = firstWord(inv.name);
    if (invFirst && invFirst === rFirst) {
      var disp = fullNameOk(inv.name) || fullNameOk(o.titleSegment) || resolved;
      return { path: PATHS.INVITEE_EMAIL, email: inv.email.trim().toLowerCase(), display_name: disp, name_key: nameKey(disp) };
    }
    // the account is not the speaker (the husband on his wife's Zoom): silent here
  }
  // ── path 2 · a full name whose first word is the speaker's first name ──
  var seg = (o.source !== 'zoom') ? (fullNameOk(o.titleSegment) || fullNameOk(titleNameSegment(o.title))) : null;
  if (seg && firstWord(seg) === rFirst) {
    return { path: PATHS.TITLE_NAME, email: null, display_name: seg, name_key: nameKey(seg) };
  }
  if (o.source === 'zoom') {
    var names = (Array.isArray(o.prospectDisplayNames) ? o.prospectDisplayNames : []).map(fullNameOk).filter(Boolean);
    var hits = names.filter(function (n) { return firstWord(n) === rFirst; });
    if (hits.length === 1) return { path: PATHS.DISPLAY_NAME, email: null, display_name: hits[0], name_key: nameKey(hits[0]) };
  }
  // ── path 3 · today's key, unchanged ──
  return { path: PATHS.RESOLVED_NAME, email: null, display_name: resolved, name_key: rKey };
}

/* Find-or-create the prospect the link names and repoint the call.
   Email first (exact), then name_key; a name-keyed prospect gains the email when it
   had none. Returns { prospect_id, created, path } or { prospect_id: null }. */
async function attachProspect(admin, args) {
  var a = args || {};
  var link = a.link;
  var out = { prospect_id: null, created: false, path: link ? link.path : null };
  if (!link || !link.path || !link.name_key) return out;
  try {
    var pid = null;
    if (link.email) {
      var byEmail = await admin.from('prospects').select('id').eq('user_id', a.userId).eq('email', link.email).maybeSingle();
      if (byEmail.error) throw new Error('prospects by email: ' + byEmail.error.message);
      pid = byEmail.data ? byEmail.data.id : null;
    }
    if (!pid) {
      var byKey = await admin.from('prospects').select('id, email').eq('user_id', a.userId).eq('name_key', link.name_key).maybeSingle();
      if (byKey.error) throw new Error('prospects by key: ' + byKey.error.message);
      if (byKey.data) {
        pid = byKey.data.id;
        if (link.email && !byKey.data.email) {
          var st = await admin.from('prospects').update({ email: link.email }).eq('id', pid).eq('user_id', a.userId);
          if (st.error) console.warn('[prospect-link] email stamp failed for ' + pid + ': ' + st.error.message);
        }
      }
    }
    if (!pid) {
      var row = { user_id: a.userId, display_name: link.display_name, name_key: link.name_key };
      if (link.email) row.email = link.email;
      var ins = await admin.from('prospects').insert(row).select('id').maybeSingle();
      if (ins.error && ins.error.code === '23505') {
        var again = await admin.from('prospects').select('id').eq('user_id', a.userId).eq('name_key', link.name_key).maybeSingle();
        pid = again.data ? again.data.id : null;
      } else if (ins.error) {
        throw new Error('prospects insert: ' + ins.error.message);
      } else {
        pid = ins.data ? ins.data.id : null; out.created = !!pid;
      }
    }
    if (pid) {
      var up = await admin.from('fathom_calls').update({ prospect_id: pid, prospect_link_path: link.path }).eq('id', a.callId).eq('user_id', a.userId);
      if (up.error) throw new Error('fathom_calls update: ' + up.error.message);
      out.prospect_id = pid;
    }
  } catch (err) {
    console.warn('[prospect-link] attach failed for ' + a.callId + ': ' + ((err && err.message) || 'unknown'));
  }
  return out;
}

module.exports = { chooseLink: chooseLink, attachProspect: attachProspect, PATHS: PATHS };
