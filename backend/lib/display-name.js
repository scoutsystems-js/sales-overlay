// lib/display-name.js — single source of truth for a user's display name.
// "First Last" when a first name is set, else the email local-part, else a
// short user-id stub. Used by team-analytics (rep cards) and anywhere else a
// human-readable name is shown, so the fallback logic lives in exactly one place.

function resolveDisplayName(profile, email, userId) {
  var first = (profile && typeof profile.first_name === 'string') ? profile.first_name.trim() : '';
  var last = (profile && typeof profile.last_name === 'string') ? profile.last_name.trim() : '';
  if (first) return (first + ' ' + last).trim();
  if (email && email.indexOf('@') !== -1) return email.split('@')[0];
  if (email) return email;
  return userId ? String(userId).slice(0, 8) : '';
}

module.exports = { resolveDisplayName: resolveDisplayName };
