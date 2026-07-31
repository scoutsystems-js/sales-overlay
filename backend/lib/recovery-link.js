// linkTargetsSetPassword(actionLink) — loud-fail guard for minted Supabase
// recovery links. Returns true ONLY when the link's redirect target is our
// /set-password page. GoTrue silently substitutes the project Site URL when
// redirect_to is not allowlisted, producing a dud we must never email. Both the
// invite mint (routes/admin.js) and the password-reset mint (routes/auth.js)
// assert against this single contract.
//
// IMPORTANT (2026-07-31 fix): GoTrue leaves redirect_to UNENCODED for a bare path
// but PERCENT-ENCODES it once it carries a query/fragment (e.g. ?flow=reset), so
// `/set-password` shows up as `%2Fset-password`. A naive substring on the raw
// action_link therefore false-negatives a valid reset link (this silently blocked
// every password-reset email). We parse the action_link, DECODE redirect_to, and
// check ITS path — which passes invite + reset alike and still rejects a Site-URL
// dud. Falls back to a raw substring only when there's no parseable redirect_to.
function linkTargetsSetPassword(actionLink) {
  if (typeof actionLink !== 'string' || actionLink.length === 0) return false;
  try {
    // URLSearchParams.get() percent-decodes, so `target` is the real redirect URL.
    var target = new URL(actionLink).searchParams.get('redirect_to');
    if (target) {
      try { return new URL(target).pathname === '/set-password'; }
      catch (e) { return target.indexOf('/set-password') !== -1; } // target not a full URL
    }
  } catch (e) { /* actionLink not a parseable URL — fall through to raw check */ }
  return actionLink.indexOf('/set-password') !== -1;
}

module.exports = { linkTargetsSetPassword: linkTargetsSetPassword };
