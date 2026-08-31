/**
 * MODEL SPEND, ATTRIBUTED — one seam for every Anthropic call (2026-08-31).
 *
 * ⚠⚠ THE DEFECT THIS CLOSES: Anthropic returns `usage.input_tokens` and
 * `usage.output_tokens` on EVERY response and Scout discarded all of it. 21 call
 * sites, 11 modules, no usage table. "Roughly $X per closer" was arithmetic on
 * an assumption, and the one genuinely unexplored lever — whether every lane
 * needs the largest model — could not even be framed, let alone tested.
 *
 * ⚠ THERE WAS NO SINGLE SEAM TO ADD IT TO. Eleven modules each defined their own
 * identical `getAnthropic()`. This module is the seam: callers ask it for the
 * client and make the request THROUGH it, so a call site cannot log the wrong
 * thing by forgetting — it can only fail to use the helper at all, which a guard
 * test catches.
 *
 * ⚠⚠ IT MUST NEVER BREAK THE CALL IT MEASURES. Every failure inside the logging
 * is caught and swallowed: a missing table, a bad column, a dead database. The
 * model response is returned regardless. Measuring spend is worth nothing if it
 * can fail an analysis.
 *
 * ⚠ THE WRITE IS NOT AWAITED. Analyses already die when Railway redeploys
 * mid-drain; adding a database round-trip to the critical path of every model
 * call would widen that window for a measurement nobody reads in real time.
 */
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let _client = null;

/* The single client. Identical to the eleven copies it replaces: same key check,
   same construction, same memoisation. Verified identical before consolidating —
   a "tidy-up" that silently changed how a client is built would be a poor trade
   for a logging feature. */
function getAnthropic() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

/* ⚠ The admin client is INJECTED rather than constructed here. Several lanes
   already hold one, and building a second Supabase client per model call would
   be a real cost for a log line. A lane with no admin client simply does not
   record — measured absence, not a crash. */
let _admin = null;
function setUsageRecorder(admin) { _admin = admin || null; }

function record(ctx, model, resp, ok) {
  try {
    if (!_admin) return;
    const u = (resp && resp.usage) || {};
    const row = {
      user_id:        (ctx && ctx.userId) || null,
      fathom_call_id: (ctx && ctx.callId) || null,
      lane:           (ctx && ctx.lane) || 'unknown',
      model:          model || 'unknown',
      input_tokens:   typeof u.input_tokens  === 'number' ? u.input_tokens  : null,
      output_tokens:  typeof u.output_tokens === 'number' ? u.output_tokens : null,
      ok:             ok !== false,
    };
    // not awaited, and its own failure is swallowed — see the header
    Promise.resolve(_admin.from('model_usage').insert(row))
      .then(function (r) {
        if (r && r.error) console.warn('[model-usage] insert failed: %s', r.error.message);
      })
      .catch(function (e) { console.warn('[model-usage] insert threw: %s', e && e.message); });
  } catch (e) {
    console.warn('[model-usage] record threw: %s', e && e.message);
  }
}

/**
 * Make the request and log what it cost.
 *
 * ⚠ A FAILED CALL IS STILL RECORDED, with ok=false and null tokens. A lane that
 * errors repeatedly is a spend question too — an error that costs nothing still
 * costs latency and a retry, and a log that only contains successes cannot show
 * a lane failing.
 */
async function createWithUsage(params, ctx) {
  const client = getAnthropic();
  let resp;
  try {
    resp = await client.messages.create(params);
  } catch (err) {
    record(ctx, params && params.model, null, false);
    throw err;
  }
  record(ctx, params && params.model, resp, true);
  return resp;
}

/* ⚠ LANE-BOUND AT IMPORT. Each module names its lane ONCE, in its require line,
   so the 12 synthesis call sites stay a single token and cannot drift into
   logging the wrong lane. Per-call context (user, call) is still passed where
   the lane has one — the analysis lanes do, a date-range synthesis does not. */
function usageFor(lane) {
  return function (params, ctx) {
    return createWithUsage(params, Object.assign({ lane: lane }, ctx || {}));
  };
}

module.exports = { getAnthropic, createWithUsage, usageFor, setUsageRecorder, _record: record };
