'use strict';
/* ⚠⚠ ONE BUCKETING CALL PER PHRASE SET IN FLIGHT. The Objections page fired
   the grid and the summary together; on a cold window both reached
   getBucketMapping with the same phrases before either had written the DB
   cache — two ~20s model calls for one answer (measured 2026-09-02: 12.4s and
   20.8s in parallel). Concurrent callers share the one call; it is NOT a
   second cache — once settled, the next caller pays again unless the DB cache
   answers. Stubbed at the module edge, same recipe as the summary test. */
const test = require('node:test');
const assert = require('node:assert');

async function withStubbedModel(delayMs, fn) {
  const p = require.resolve('@anthropic-ai/sdk');
  const saved = require.cache[p];
  const calls = [];
  require.cache[p] = { id: p, filename: p, loaded: true, exports: function Anthropic() {
    return { messages: { create: async (args) => {
      calls.push(args); await new Promise((r) => setTimeout(r, delayMs));
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ buckets: [
        { label: 'Fear', class: 'true_objection', phrases: ['too expensive', 'need to think'] },
        { label: 'Logistical', class: 'logistical_barrier', phrases: ['card declined'] } ] }) }] };
    } } };
  } };
  delete require.cache[require.resolve('../lib/model-usage')];
  delete require.cache[require.resolve('../lib/team-needs-work')];
  const mod = require('../lib/team-needs-work');
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try { return await fn(mod, calls); }
  finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
    if (saved) require.cache[p] = saved; else delete require.cache[p];
    delete require.cache[require.resolve('../lib/model-usage')];
    delete require.cache[require.resolve('../lib/team-needs-work')];
  }
}
const SET = [{ surface: 'too expensive' }, { surface: 'need to think' }, { surface: 'card declined' }, { surface: 'too expensive' }];
const OTHER = [{ surface: 'not right now' }];

test('⚠⚠ two concurrent callers with the same phrases → ONE model call, both get the mapping', async () => {
  await withStubbedModel(40, async (mod, calls) => {
    const [a, b] = await Promise.all([mod.getBucketMapping(SET), mod.getBucketMapping(SET.slice().reverse())]);
    assert.strictEqual(calls.length, 1, 'one bucketing call for the pair');
    assert.ok(a.ok && b.ok, 'both callers get a result');
    assert.strictEqual(a.mapping['too expensive'], 'Fear');
    assert.strictEqual(b.bucketClass['Logistical'], 'logistical_barrier');
    await mod.getBucketMapping(SET);
    assert.strictEqual(calls.length, 2, 'after it settles the next caller pays — this is not a cache');
  });
});

test('⚠ different phrase sets in flight together are separate calls', async () => {
  await withStubbedModel(40, async (mod, calls) => {
    await Promise.all([mod.getBucketMapping(SET), mod.getBucketMapping(OTHER)]);
    assert.strictEqual(calls.length, 2);
  });
});
