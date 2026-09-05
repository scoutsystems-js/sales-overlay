#!/usr/bin/env node
'use strict';
/* H732 — load Scout's doctrine into the knowledge base: ELEVEN units, global scope, category 'doctrine', one row per
   entry, embedded in one batch. Idempotent on metadata.key + version: an existing unit at the same version is left,
   a stale version is replaced. DRY by default; --apply writes. Embedding needs VOYAGE_API_KEY in the process (the key
   lives on Railway; export it for the run — never printed, never written); refuses to write unembedded rows. */
const fs = require('fs'); const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'API Keys.md'), 'utf8');
const pick = (n) => { const m = keys.match(new RegExp(n + '\\s*[=:]\\s*([^\\s`]+)')); return m ? m[1] : null; };
process.env.SUPABASE_URL = pick('SUPABASE_URL'); process.env.SUPABASE_SERVICE_ROLE_KEY = pick('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const D = require('../lib/doctrine');
const { getVoyageEmbeddings, embeddingCapability } = require('../lib/voyage');
const APPLY = process.argv.indexOf('--apply') !== -1;
(async () => {
  const units = D.readDoctrineFile();
  if (units.length !== 11) throw new Error('expected 11 units, parsed ' + units.length);
  const rows = D.doctrineRows(units);
  const existing = await admin.from('knowledge_base').select('id, metadata').eq('category', D.CATEGORY).eq('scope', 'global');
  if (existing.error) throw new Error(existing.error.message);
  const byKey = {}; (existing.data || []).forEach((r) => { byKey[(r.metadata || {}).key] = r; });
  const toInsert = rows.filter((r) => !byKey[r.metadata.key] || (byKey[r.metadata.key].metadata || {}).version !== r.metadata.version);
  const toDelete = toInsert.map((r) => byKey[r.metadata.key]).filter(Boolean).map((r) => r.id);
  console.log((APPLY ? 'APPLY' : 'DRY RUN') + ': ' + units.length + ' units parsed; ' + (existing.data || []).length + ' stored; ' + toInsert.length + ' to write; ' + toDelete.length + ' stale to replace');
  units.forEach((u) => console.log('  ' + u.order + '. ' + u.title + ' (' + u.text.length + ' chars)'));
  if (!APPLY) return;
  const cap = embeddingCapability(); if (!cap.ok) { console.error('REFUSED: ' + cap.reason); process.exit(3); }
  if (!toInsert.length) { console.log('nothing to write'); return; }
  const embs = await getVoyageEmbeddings(toInsert.map((r) => r.content), 'doctrine');
  if (!embs || embs.some((e) => !e)) { console.error('REFUSED: embedding failed for at least one unit — nothing written'); process.exit(4); }
  if (toDelete.length) { const del = await admin.from('knowledge_base').delete().in('id', toDelete); if (del.error) throw new Error(del.error.message); }
  const ins = await admin.from('knowledge_base').insert(toInsert.map((r, i) => Object.assign({}, r, { embedding: embs[i] })));
  if (ins.error) throw new Error(ins.error.message);
  const after = await admin.from('knowledge_base').select('id', { count: 'exact', head: true }).eq('category', D.CATEGORY).eq('scope', 'global');
  console.log('written ' + toInsert.length + '; stored now: ' + after.count);
})().catch((e) => { console.error(e); process.exit(1); });
