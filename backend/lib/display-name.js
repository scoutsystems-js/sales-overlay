// lib/display-name.js — THE single source of truth for how a person is named.
//
// ⚠ IT EXISTED BEFORE THIS AND HAD EXACTLY ONE CONSUMER. Every other surface
// wrote its own `email.split('@')[0]`, which is why the same person read
// "Joshua Pinner" on one screen and "josh" on another. Justin: "it's hard to
// tell what's what for the person." Nine call sites now route through here.
//
// PRECEDENCE (ruled 2026-08-17):
//   1. the stored full name  (user_profiles.first_name / last_name)
//   2. the email local-part, TITLE CASED and de-punctuated
//   3. a short user-id stub, so something always renders
//
// ⚠ NEVER A RAW LOWERCASE HANDLE. "josh" and "demo-ava" are handles, not names;
// on a board a manager shows to other people they read as debug output.
//
// ⚠ THIS IS NOT THE SPEAKER-IDENTITY PATH. `analysis-worker` matches an email
// local-part against a transcript display name to decide WHO IS THE CLOSER —
// that is an identity comparison, not a label, and title-casing it would break
// the match. It is deliberately not routed through here.

// "ava.mitchell" / "demo-ben" / "j_smith" → "Ava Mitchell" / "Demo Ben" / "J Smith"
function titleCaseHandle(handle) {
  return String(handle || '')
    .replace(/[._\-+]+/g, ' ')          // handle separators become spaces
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(function (w) {
      // ⚠ Only the FIRST letter is forced. Upper-casing the rest would turn
      // "McCarthy" into "Mccarthy" and "O'Brien" into "O'brien" — a name is the
      // one label where the owner's own capitalisation wins.
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function resolveDisplayName(profile, email, userId) {
  var first = (profile && typeof profile.first_name === 'string') ? profile.first_name.trim() : '';
  var last = (profile && typeof profile.last_name === 'string') ? profile.last_name.trim() : '';
  if (first || last) return (first + ' ' + last).trim();
  if (email && email.indexOf('@') !== -1) return titleCaseHandle(email.split('@')[0]);
  if (email) return titleCaseHandle(email);
  return userId ? String(userId).slice(0, 8) : '';
}

// For the call sites that hold only an email (digest lanes, prompt inputs).
// Same rules, so they cannot drift from the profile-aware path above.
function displayNameFromEmail(email, fallback) {
  if (!email) return fallback || '';
  var local = email.indexOf('@') !== -1 ? email.split('@')[0] : email;
  return titleCaseHandle(local) || (fallback || '');
}

/**
 * NORMALISE A NAME AT WRITE TIME (Justin's ruling 2026-08-17): "use whatever name
 * they use when they create their profile — if it's lowercase just capitalize it
 * when saving." Capitalising on the way IN beats fixing it at every render: one
 * write, and every reader — including prompts and exports — gets it right.
 *
 * ⚠ IT ONLY ACTS ON AN ALL-LOWERCASE INPUT. If the person typed ANY capital, we
 * leave their string alone. That is what protects "McDonald", "de Vries",
 * "van der Berg" and "O'Brien" when they are typed correctly — forcing a scheme
 * onto them would be worse than the problem being fixed. A name is the one field
 * where the owner's own spelling is the authority.
 *
 * ⚠ STATED LIMITATION, not hidden: for input that IS all-lowercase we capitalise
 * the first letter of each word and of each part after a hyphen or apostrophe.
 * So "mary-jane" → "Mary-Jane" and "o'brien" → "O'Brien", but "mcdonald" →
 * "Mcdonald", which is wrong. Detecting Mc/Mac/de/van reliably needs a name
 * database and gets other names wrong in exchange; the escape hatch is that the
 * user can type "McDonald" themselves and we will not touch it.
 */
function normalizeName(input) {
  var s = String(input == null ? '' : input).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (/[A-Z]/.test(s)) return s;           // they capitalised it — their call
  return s.replace(/(^|[\s\-'\u2019])([a-z])/g, function (_m, sep, ch) {
    return sep + ch.toUpperCase();
  });
}

/**
 * DISAMBIGUATE A SET OF PEOPLE (Justin, 2026-08-29): "when two people on a board
 * share a first name, show the surname initial — Josh P."
 * Live today: Josh Pinner and Josh Niebloom on one board.
 *
 * WHY IT MATTERS MOST IN PROSE, NOT IN A COLUMN. A grid shows the full name and
 * the two are already distinct — but the digest and the coaching lanes hand
 * these labels to a MODEL, and the model SHORTENS them: a real digest reads
 * "Yazan's close on Alicia Robinson is the model". With two Joshes that becomes
 * "Josh", naming one rep's work as another's, with nothing on screen to say
 * which. Making the LABEL itself unambiguous is what survives being shortened.
 *
 * ONLY COLLIDING NAMES CHANGE. A rep whose first name is unique keeps their full
 * name exactly as before — this fixes an ambiguity, it is not a rename.
 *
 * AND IT NEVER INVENTS AN INITIAL IT DOES NOT HAVE. If a colliding person has no
 * surname their label is left unchanged: a wrong initial is worse than the
 * collision it was meant to solve — the same governing rule as prospect names.
 *
 * @param {Object} nameMap  { id: "Full Name" }
 * @returns {Object}        { id: "Full Name" | "First L" }
 */
function disambiguateNames(nameMap) {
  var out = {};
  if (!nameMap || typeof nameMap !== 'object') return out;
  var ids = Object.keys(nameMap);

  var byFirst = {};
  ids.forEach(function (id) {
    var first = String(nameMap[id] || '').trim().split(/\s+/)[0] || '';
    if (!first) return;
    var key = first.toLowerCase();
    (byFirst[key] = byFirst[key] || []).push(id);
  });

  ids.forEach(function (id) {
    var full = String(nameMap[id] || '').trim();
    var parts = full.split(/\s+/).filter(Boolean);
    var group = byFirst[(parts[0] || '').toLowerCase()] || [];
    if (group.length < 2 || parts.length < 2) { out[id] = full; return; }
    out[id] = parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase();
  });
  return out;
}

module.exports = {
  resolveDisplayName: resolveDisplayName,
  disambiguateNames: disambiguateNames,
  normalizeName: normalizeName,
  displayNameFromEmail: displayNameFromEmail,
  titleCaseHandle: titleCaseHandle,
};
