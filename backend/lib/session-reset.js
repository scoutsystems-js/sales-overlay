/* One application-wide session cutoff, used only for deliberate forced sign-outs.
 * Supabase refresh-token revocation alone leaves an access token usable until its
 * expiry, so Scout checks this durable cutoff after Supabase has authenticated it.
 */

function issuedAt(token) {
  if (typeof token !== 'string') return null;
  try {
    var payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload.iat) ? payload.iat * 1000 : null;
  } catch (err) {
    return null;
  }
}

async function minimumIssuedAt(supabase) {
  var result = await supabase
    .from('auth_runtime_controls')
    .select('minimum_session_issued_at')
    .eq('id', true)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || !result.data.minimum_session_issued_at) return null;
  var cutoff = Date.parse(result.data.minimum_session_issued_at);
  return Number.isFinite(cutoff) && cutoff > 0 ? cutoff : null;
}

async function requiresSessionReset(supabase, token) {
  var cutoff = await minimumIssuedAt(supabase);
  if (!cutoff) return false;
  var tokenIssuedAt = issuedAt(token);
  return !tokenIssuedAt || tokenIssuedAt <= cutoff;
}

module.exports = { issuedAt, minimumIssuedAt, requiresSessionReset };
