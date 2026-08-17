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

module.exports = {
  resolveDisplayName: resolveDisplayName,
  normalizeName: normalizeName,
  displayNameFromEmail: displayNameFromEmail,
  titleCaseHandle: titleCaseHandle,
};
