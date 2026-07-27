// C-1: "Generate summary" — a page-agnostic executive summary of a manager-view
// page. The CLIENT hands us the page's already-loaded data + a human label; we
// do NOT re-fetch or recompute anything. Claude writes short exec-voice prose
// AROUND the handed numbers and is told never to invent or recompute a figure.
// Here the prose IS the deliverable, so (unlike the needs-work lane) Claude
// authors the text.
//
// Optional short cache: keyed on md5(page_label + payload JSON) in
// objection_synthesis_cache (synthesis_type='page_summary', fixed epoch from/to
// sentinels — the hash carries the real key). A cache hit = no Claude call, so a
// manager re-opening the same summary (identical page/range/pivot) is free.
// Cost shape WITHOUT cache: one Claude call per button click (short output, small
// input = the page payload). It's a manual button, so volume is low either way.

const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { CLAUDE_MODEL } = require('../config');
const { cacheGet, cachePut } = require('./team-synthesis');

const MAX_DATA_CHARS = 12000;   // cap the page payload injected into the prompt
const SUMMARY_MAX_TOKENS = 700;
const EPOCH = '1970-01-01T00:00:00.000Z'; // from/to sentinel; hash differentiates

var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Returns {available, cached?, summary, generated_at} | {available:false, reason}.
// Never throws for content reasons; a Claude/config failure returns available:false.
async function computePageSummary(admin, userId, pageLabel, data) {
  var json;
  try { json = JSON.stringify(data); } catch (_) { json = null; }
  if (!json) return { available: false, reason: 'Page data was not summarizable.' };
  if (json.length > MAX_DATA_CHARS) json = json.slice(0, MAX_DATA_CHARS) + ' …(truncated)';

  var hash = crypto.createHash('md5').update((pageLabel || '') + '||' + json).digest('hex');
  var cached = await cacheGet(admin, userId, 'page_summary', EPOCH, EPOCH, hash);
  if (cached && cached.summary) return { available: true, cached: true, summary: cached.summary, generated_at: cached.generated_at };

  var prompt = [
    'You are writing a SHORT executive summary of ONE page of a sales-team dashboard, for a busy manager to paste straight into Slack or email with NO edits.',
    'PAGE: ' + (pageLabel || 'Dashboard page'),
    '',
    'DATA — already computed by the app. These numbers are the source of truth. Use them; NEVER invent, estimate, or recompute any figure, and never state a number that is not present in this data:',
    json,
    '',
    'Write 3-6 sentences of plain English: what is happening on this page and what it means. Lead with the headline. If the data names reps, name them. One or two tight bullets are fine, but no section headers, no markdown decoration, and no preamble like "Here is" or "Summary:". Confident, concise, decision-useful — the kind of note an exec reads in ten seconds and forwards.',
    'Respond with ONLY the summary text.',
  ].join('\n');

  var text;
  try {
    var resp = await getAnthropic().messages.create({ model: CLAUDE_MODEL, max_tokens: SUMMARY_MAX_TOKENS, messages: [{ role: 'user', content: prompt }] });
    text = (resp.content && resp.content[0] && resp.content[0].text ? resp.content[0].text : '').trim();
  } catch (e) {
    return { available: false, reason: 'Anthropic API failure' + ((e && e.status) ? ' (HTTP ' + e.status + ')' : '') + ': ' + ((e && e.message) || 'unknown') };
  }
  if (!text) return { available: false, reason: 'The summary came back empty — try again.' };

  var out = { summary: text, generated_at: new Date().toISOString() };
  await cachePut(admin, userId, 'page_summary', EPOCH, EPOCH, hash, out);
  return Object.assign({ available: true, cached: false }, out);
}

module.exports = { computePageSummary: computePageSummary };
