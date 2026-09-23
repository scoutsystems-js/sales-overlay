/*
 * Block 039's private, off-database proof for the dedicated Personal Coaching
 * evidence reader. It reads five existing transcript copies, asks for turn
 * numbers only, and writes an anonymized receipt. It never writes Scout data.
 *
 * Default: measure only. `--run` makes at most five bounded model requests,
 * after enforcing a conservative under-$20 ceiling.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { CLAUDE_MODEL } = require('../config');
const reader = require('../lib/focus-evidence-reader');
const { countsAsObjection } = require('../lib/objection-strict');

const ROOT = path.resolve(__dirname, '../../../../..');
const KEY_FILE = path.join(ROOT, 'API Keys.md');
const REPORT_FILE = path.join(process.env.HOME, 'Desktop/scan-reports/block-039-focus-evidence-reader/receipt.json');
const RUN = process.argv.includes('--run');
const TARGET_FEAR = process.argv.includes('--target-fear');
const MAX_OUTPUT_TOKENS = 350;
const SPECIMENS = [
  '93562168-253c-4fbe-8e46-df452dfdd165',
  '462a0ba5-6676-438b-8c27-e2738a5a1f18',
  '331a92ce-262e-4270-b685-20fbdd82ec43',
  'b91d0ac1-97cd-45eb-b0a9-8eee4dc12561',
  'a27c6af7-e1b2-4d88-8ba6-0e0603606748',
];

function key(name) {
  const row = fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/).find((line) => line.startsWith(name + '='));
  if (!row) throw new Error('Missing ' + name + ' in API Keys.md');
  return row.slice(name.length + 1).trim();
}

function safeId(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 10); }

function matchedTurns(turns) {
  return Array.isArray(turns) && turns.length > 0 && turns.every((turn) =>
    turn && (turn.speaker === 'CLOSER' || turn.speaker === 'PROSPECT') && typeof turn.text === 'string' && turn.text.trim()
  );
}

function focusFor(rows) {
  const objection = (rows || []).find((row) => row.type === 'objection' && countsAsObjection(row) && reader.normalizeFocus({ stage: 'objection', category: row.objection_category }));
  if (objection) return { stage: 'objection', category: objection.objection_category };
  const stage = (rows || []).find((row) => reader.normalizeFocus({ stage: row.section }));
  return stage ? { stage: stage.section } : null;
}

async function countTokens(apiKey, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  const body = await response.json();
  if (!response.ok || !Number.isInteger(body.input_tokens)) throw new Error('Token measurement unavailable');
  return body.input_tokens;
}

function worstCaseDollars(inputTokens, calls) {
  // $3/M input and $15/M output, doubled before dispatch as a retry-safe cap.
  return 2 * ((inputTokens * 3) + (calls * MAX_OUTPUT_TOKENS * 15)) / 1000000;
}

function receiptRow(item, result) {
  return {
    specimen: safeId(item.id),
    focus: item.focus,
    input_tokens: item.input_tokens,
    response_shape: result && result.shape || null,
    verified: Boolean(result && result.verified),
  };
}

async function main() {
  const apiKey = key('ANTHROPIC_API_KEY');
  const supabase = createClient(key('SUPABASE_URL'), key('SUPABASE_SERVICE_ROLE_KEY'));
  let highlights;
  if (TARGET_FEAR) {
    highlights = await supabase.from('call_highlights')
      .select('fathom_call_id,type,section,objection_category,objection_class,resolution')
      .eq('type', 'objection').eq('objection_category', 'fear').eq('resolution', 'handled').limit(80);
  } else {
    highlights = await supabase.from('call_highlights')
      .select('fathom_call_id,type,section,objection_category,objection_class,resolution')
      .in('fathom_call_id', SPECIMENS);
  }
  if (highlights.error) throw new Error('Read-only highlight query failed: ' + highlights.error.message);
  const ids = TARGET_FEAR
    ? [...new Set((highlights.data || []).filter(countsAsObjection).map((row) => row.fathom_call_id))].slice(0, 20)
    : SPECIMENS;
  const analyses = await supabase.from('call_analyses').select('fathom_call_id,transcript_stored').in('fathom_call_id', ids);
  if (analyses.error) throw new Error('Read-only transcript query failed: ' + analyses.error.message);
  const highlightByCall = {};
  (highlights.data || []).forEach((row) => { (highlightByCall[row.fathom_call_id] ||= []).push(row); });
  const items = (analyses.data || []).map((row) => {
    const turns = row.transcript_stored && row.transcript_stored.turns;
    const focus = TARGET_FEAR ? { stage: 'objection', category: 'fear' } : focusFor(highlightByCall[row.fathom_call_id]);
    return { id: row.fathom_call_id, turns, focus };
  }).filter((item) => item.focus && matchedTurns(item.turns)).slice(0, 5);
  if (!items.length) throw new Error('The fixed sandbox contains no usable focus/transcript pair.');
  for (const item of items) {
    item.prompt = reader.buildPrompt(item.focus, item.turns);
    item.input_tokens = await countTokens(apiKey, item.prompt);
  }
  const inputTokens = items.reduce((sum, item) => sum + item.input_tokens, 0);
  const worstCase = worstCaseDollars(inputTokens, items.length);
  if (worstCase > 20) throw new Error('Measured sandbox exceeds the $20 cap: $' + worstCase.toFixed(2));

  const base = {
    purpose: 'Read-only proof of dedicated focus-specific turn-number evidence reader',
    model: CLAUDE_MODEL,
    sample: TARGET_FEAR ? 'five explicit handled Fear candidates' : 'the original mixed five-call capture set',
    specimens: items.length,
    input_tokens: inputTokens,
    max_output_tokens_per_call: MAX_OUTPUT_TOKENS,
    retry_safe_cost_ceiling_usd: Number(worstCase.toFixed(4)),
    boundary: 'No Scout database rows, calls, scores, outcomes, highlights, cache entries, or transcripts are written. The receipt keeps no transcript text, customer names, quotes, raw model output, or call IDs.',
  };
  if (!RUN) {
    console.log(JSON.stringify({ ...base, run: false, next: 'Re-run with --run only after the measured ceiling is accepted.' }, null, 2));
    return;
  }
  const anthropic = new Anthropic({ apiKey });
  const responses = [];
  for (const item of items) {
    const response = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: MAX_OUTPUT_TOKENS, messages: [{ role: 'user', content: item.prompt }] });
    const text = (response.content || []).map((part) => part.text || '').join('');
    const candidate = reader.parseResponse(text);
    const verified = reader.verifyCandidate(candidate, item.focus, item.turns);
    responses.push(receiptRow(item, {
      shape: candidate ? 'object' : (String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim() === 'null' ? 'null' : 'invalid'),
      verified,
    }));
  }
  const receipt = {
    ...base,
    run: true,
    results: responses,
    verified_sequences: responses.filter((row) => row.verified).length,
  };
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
