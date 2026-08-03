// Grader v11 — the prospect_name field (PROSPECT NAMES 3b).
//
// The contract is deliberately the v7 follow-up-email greeting rule REUSED
// VERBATIM: transcript-only, null when unclear, never the meeting title. That
// rule was already proven in production (it is why the follow-up email greets
// "Jamie" on a call whose title says "Tasha"), so 3b inherits a known-good
// contract rather than inventing a second, subtly different one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8');

test('ANALYSIS_PROMPT_VERSION is bumped to v11', () => {
  // House rule: a prompt change and its version bump are ONE atomic change. If
  // the constant lags the prompt, every downstream system lies coherently.
  assert.match(src, /ANALYSIS_PROMPT_VERSION = 'v11-2026-08-03'/);
});

test('the grader asks for prospect_name and declares it in the JSON shape', () => {
  assert.ok(/- prospect_name:/.test(src), 'field instruction missing');
  assert.ok(/"prospect_name": "\.\.\." \| null/.test(src), 'JSON shape entry missing');
});

test('the prospect_name rule is TRANSCRIPT-ONLY and forbids the meeting title', () => {
  const line = src.split('\n').find((l) => l.indexOf('- prospect_name:') !== -1);
  assert.ok(line, 'prospect_name instruction not found');
  assert.ok(/IN THE TRANSCRIPT/.test(line), 'must anchor the name to the transcript');
  assert.ok(/return null/.test(line), 'must return null when unclear rather than guessing');
  assert.ok(/[Nn]ever take a name from the meeting title/.test(line), 'must forbid the meeting title — the entire bug');
});

test('a couple returns as ONE joined name (ruling: couples are one prospect)', () => {
  const line = src.split('\n').find((l) => l.indexOf('- prospect_name:') !== -1);
  assert.ok(/ONE prospect/.test(line));
  assert.ok(/ and /.test(line), 'must specify the join form');
});

test('the grader name is fed into the resolver, not written directly', () => {
  // Precedence, rejection rules and the couples cap all live in
  // lib/prospect-name.js. Writing graderParsed.prospect_name straight to the
  // column would bypass every one of them.
  assert.ok(/graderName:\s+\(typeof graderParsed\.prospect_name === 'string'\)/.test(src),
    'grader name must be passed to resolveProspectName');
  assert.ok(/prospect_name:\s+resolvedProspect\.name/.test(src),
    'the persisted value must come from the resolver');
});

test('v11 is ADDITIVE — the scoring/outcome instructions are untouched', () => {
  // Why no delta-gate is needed. Same reasoning that let v10 ship without one.
  assert.ok(/ADDITIVE/.test(src));
  assert.ok(/85-100: exceptional/.test(src), 'the anchored rubric must still be present');
  assert.ok(/25-35% close rate is STRONG/.test(src), 'domain context must still be present');
});
