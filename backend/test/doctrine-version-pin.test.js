'use strict';
// THE DOCTRINE-HASH GUARD (Justin, 2026-09-08, cutover Stage B). The grader prompt
// is built from backend/doctrine/scout-doctrine.md at build time, so a doctrine
// edit changes what new calls are graded against. Nothing else forces
// ANALYSIS_PROMPT_VERSION to move with it — a doctrine edit under an unchanged
// version string is the cache-key problem in a new place. The file's hash is
// pinned beside the version constant; a doctrine edit without touching both fails
// here, in the same suite that pins the version itself.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const W=require('../lib/analysis-worker');

test('the doctrine file hash pinned beside ANALYSIS_PROMPT_VERSION matches the file; a doctrine edit must bump the version and re-pin',()=>{
 const file=path.join(__dirname,'..','doctrine','scout-doctrine.md');
 const actual=crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
 assert.match(String(W.DOCTRINE_FILE_SHA1),/^[0-9a-f]{40}$/,'DOCTRINE_FILE_SHA1 is exported from analysis-worker.js beside ANALYSIS_PROMPT_VERSION');
 assert.equal(W.DOCTRINE_FILE_SHA1,actual,
  'backend/doctrine/scout-doctrine.md changed. The grader prompt embeds it, so this is a prompt change: bump ANALYSIS_PROMPT_VERSION and set DOCTRINE_FILE_SHA1 to '+actual+' in the same commit.');
 // the pin sits beside the version constant in the source, not somewhere a reader would miss
 const src=fs.readFileSync(require.resolve('../lib/analysis-worker'),'utf8');
 const lines=src.split('\n');const v=lines.findIndex(l=>l.startsWith('const ANALYSIS_PROMPT_VERSION ='));const d=lines.findIndex(l=>l.startsWith('const DOCTRINE_FILE_SHA1 ='));
 assert.ok(v>=0&&d>=0&&Math.abs(d-v)<=8,'DOCTRINE_FILE_SHA1 is declared within eight lines of ANALYSIS_PROMPT_VERSION (the version line carries a long comment, so the distance is in lines)');
});
