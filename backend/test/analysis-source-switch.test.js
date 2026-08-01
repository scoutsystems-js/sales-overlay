// Sub-stage 2 — analyzeCall source-switch decision (TDD).
// The full analyzeCall hits DB + network, so we test the pure branch predicate
// that decides which transcript path runs. 'zoom' → Zoom (call_connections +
// VTT); anything else (fathom / null / legacy rows) → Fathom, unchanged.
const test = require('node:test');
const assert = require('node:assert');

const worker = require('../lib/analysis-worker');

test('transcriptSourceFor returns "zoom" only for source === "zoom"', function () {
  assert.strictEqual(worker.transcriptSourceFor({ source: 'zoom' }), 'zoom');
});

test('transcriptSourceFor returns "fathom" for fathom / null / missing (legacy rows)', function () {
  assert.strictEqual(worker.transcriptSourceFor({ source: 'fathom' }), 'fathom');
  assert.strictEqual(worker.transcriptSourceFor({ source: null }), 'fathom');
  assert.strictEqual(worker.transcriptSourceFor({}), 'fathom');
  assert.strictEqual(worker.transcriptSourceFor(null), 'fathom');
});

test('transcriptSourceFor does not treat an unknown source as zoom', function () {
  assert.strictEqual(worker.transcriptSourceFor({ source: 'webex' }), 'fathom');
});
