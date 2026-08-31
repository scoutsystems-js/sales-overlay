/**
 * ⚠⚠ MODEL SPEND MUST BE ATTRIBUTABLE, AND LOGGING MUST NEVER BREAK THE CALL.
 * Anthropic returns token counts on every response and Scout discarded all of
 * it — 21 call sites, 11 modules, no usage table. This is the seam.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const mu = require('../lib/model-usage');

test('a failing recorder never breaks the call it measures', async () => {
  mu.setUsageRecorder({ from() { throw new Error('database is on fire'); } });
  // record() must swallow its own failure entirely
  assert.doesNotThrow(() => mu._record({ lane: 'x' }, 'm', { usage: { input_tokens: 1 } }, true));
  mu.setUsageRecorder(null);
  assert.doesNotThrow(() => mu._record({ lane: 'x' }, 'm', { usage: {} }, true));
});

test('⚠ missing token counts are NULL, never 0 — absent is not zero', async () => {
  const rows = [];
  mu.setUsageRecorder({ from: () => ({ insert: (r) => { rows.push(r); return Promise.resolve({ error: null }); } }) });
  mu._record({ lane: 'l' }, 'm', { usage: {} }, true);
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(rows[0].input_tokens, null, 'a missing count must not read as zero spend');
  assert.strictEqual(rows[0].output_tokens, null);
  mu.setUsageRecorder(null);
});

test('a FAILED call is still recorded, with ok=false', async () => {
  const rows = [];
  mu.setUsageRecorder({ from: () => ({ insert: (r) => { rows.push(r); return Promise.resolve({ error: null }); } }) });
  mu._record({ lane: 'grader' }, 'claude-sonnet-4-6', null, false);
  await new Promise(r => setTimeout(r, 10));
  assert.strictEqual(rows[0].ok, false, 'a lane that errors repeatedly is a spend question too');
  mu.setUsageRecorder(null);
});

test('⚠⚠ every model call goes through the seam — none may call messages.create directly', () => {
  const fs = require('fs'), path = require('path');
  const dirs = ['lib', 'routes'];
  const offenders = [];
  dirs.forEach((d) => {
    fs.readdirSync(path.join(__dirname, '..', d)).filter(f => f.endsWith('.js')).forEach((f) => {
      const rel = d + '/' + f;
      if (rel === 'lib/model-usage.js') return;               // the seam itself
      if (rel === 'routes/proxy.js') return;                  // dormant desktop teleprompter — see below
      const src = fs.readFileSync(path.join(__dirname, '..', d, f), 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
      const n = (src.match(/messages\.create\(/g) || []).length;
      if (n) offenders.push(rel + ' (' + n + ')');
    });
  });
  /* ⚠ routes/proxy.js is EXEMPT and that is a ruling, not an oversight: its five
     calls serve the DORMANT desktop teleprompter, which no live user reaches.
     Wiring it would add spend rows for a surface that produces none. */
  assert.deepStrictEqual(offenders, [], 'these call Anthropic without recording spend');
});
