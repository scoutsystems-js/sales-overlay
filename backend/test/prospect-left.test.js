
// "THE PROSPECT LEFT" — the ninth moment type (H725, Justin's ruling 2026-09-04). The prospect ends,
// defers or withdraws WITHOUT a stated reason the offer does not apply. A stated reason is a
// disqualification; leaving without one is leaving. New calls only; no rate reads the type.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../lib/analysis-worker');
const P = require('../lib/missed-signal-pair');
const bar = require('../lib/moment-bar');
const ER = require('../lib/evidence-rule');

test('the ninth type is valid, prospect-positioned (never a closer line), and stamped v43', () => {
  assert.ok(W._VALID_HIGHLIGHT_TYPES.indexOf('prospect_left') !== -1);
  assert.ok(W._violatesProspectAnchor({ type: 'prospect_left', speaker: 'CLOSER' }) === true, 'a closer line is refused as a leaving');
  assert.ok(W._PROSPECT_POSITION_TYPES.indexOf('prospect_left') === -1, 'it is NOT a handling-badge type (the review page mirrors that set)');
  const s = W._sanitizeHighlights([
    { timestamp_seconds: 600, speaker: 'PROSPECT', quote: 'I can get back to you, is his name Derek?', observation: 'o', type: 'prospect_left', section: 'close' },
    { timestamp_seconds: 700, speaker: 'CLOSER', quote: 'our conversation is a little premature', observation: 'o', type: 'prospect_left', section: 'close' },
  ], 3000);
  assert.strictEqual(s.length, 1, 'a closer line can never be a leaving');
  assert.strictEqual(s[0].type, 'prospect_left');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'analysis-worker.js'), 'utf8'), /ANALYSIS_PROMPT_VERSION = 'v44-2026-09-05'/);
});

test('the prompt states the discriminator: a stated reason the offer does not apply is a disqualification; leaving without one is leaving', () => {
  const prompt = W._buildHighlightExtractorPrompt({ turns: [{ speaker: 'CLOSER', text: 'hi', start_seconds: 1 }], speaker_confidence: 'matched' });
  const line = prompt.split('\n').find((l) => /"prospect_left"/.test(l));
  assert.ok(line, 'the type is defined');
  assert.ok(/reschedul/i.test(line) && /withdraw/i.test(line), 'reschedule and withdrawal are named');
  assert.ok(/WITHOUT a stated reason/i.test(line) && /Never type a leaving as a disqualification/.test(line), 'the discriminator is stated');
});

test('a leaving is never the DQ end of a missed-signal pair; a lone leaving falls at the bar; the evidence rule counts it as negative', () => {
  const rows = [
    { id: 's', type: 'risk_signal', handling: 'deflected', speaker: 'PROSPECT', timestamp_seconds: 100, quote: 'q' },
    { id: 'l', type: 'prospect_left', speaker: 'PROSPECT', timestamp_seconds: 2000, quote: 'I have to go' },
  ];
  assert.strictEqual(P.findMissedSignalPairs(rows).length, 0, 'leaving is not a disqualification');
  assert.strictEqual(bar.momentReason({ type: 'prospect_left', speaker: 'PROSPECT' }), null);
  assert.ok(ER.NEGATIVE_TYPES.indexOf('prospect_left') !== -1);
  assert.ok(/prospect_left/.test(ER.EVIDENCE_RULE));
  assert.match(ER.EVIDENCE_RULE_VERSION, /^v2-/);
});

test('the dashboard names it and mirrors the prospect-position set; the migration lists nine types', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  assert.ok(/prospect_left:\s*'Prospect left'/.test(page), 'the review page labels it');
  const mig = fs.readFileSync(path.join(__dirname, '..', 'migrations', '071_prospect_left.sql'), 'utf8');
  W._VALID_HIGHLIGHT_TYPES.forEach((t) => assert.ok(mig.indexOf("'" + t + "'") !== -1, 'migration 071 must list ' + t));
});
