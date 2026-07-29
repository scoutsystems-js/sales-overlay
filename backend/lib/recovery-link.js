// linkTargetsSetPassword(actionLink) — loud-fail guard for minted Supabase
// recovery links. Returns true ONLY when the link points at our /set-password
// page. GoTrue silently substitutes the project Site URL when redirect_to is not
// in the Auth redirect allowlist, producing a link that lands nowhere useful — a
// dud we must never email. Both the invite mint (routes/admin.js) and the
// password-reset mint (routes/auth.js) assert against this single contract.
//
// Matches the invite form (`…/set-password`) and the reset form
// (`…/set-password?flow=reset`); rejects Site-URL fallbacks and non-strings.
function linkTargetsSetPassword(actionLink) {
  return typeof actionLink === 'string' && actionLink.indexOf('/set-password') !== -1;
}

module.exports = { linkTargetsSetPassword: linkTargetsSetPassword };
