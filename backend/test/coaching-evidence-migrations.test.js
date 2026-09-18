'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('the two capture migrations add nullable evidence fields without changing existing highlight facts', async () => {
  const db = new PGlite();
  await db.exec('CREATE TABLE call_highlights (id uuid PRIMARY KEY, quote text NOT NULL, resolution text);');
  await db.exec("INSERT INTO call_highlights (id, quote, resolution) VALUES ('00000000-0000-0000-0000-000000000001', 'existing quote', 'handled');");
  for (const file of ['080_objection_coaching_sequence.sql', '081_stage_coaching_evidence.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));
  }
  const row = await db.query('SELECT quote, resolution, coaching_sequence, coaching_evidence FROM call_highlights');
  assert.deepEqual(row.rows, [{ quote: 'existing quote', resolution: 'handled', coaching_sequence: null, coaching_evidence: null }]);
  await db.close();
});
