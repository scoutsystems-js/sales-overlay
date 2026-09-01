'use strict';
/* ⚠⚠ DESIGN PASS PART 2 — THE OBJECTIONS PAGE (2026-09-01).
   (a) borders become space, (d) four facts get four treatments, (e) a timestamp
   replaces "57% through the call". */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const LIB  = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-objection-summary.js'), 'utf8');
const strip = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('⚠⚠ (e) a TIMESTAMP, not a percentage — and the payload carries one', () => {
  const live = strip(LIB);
  assert.ok(/ts:\s*hmsOf\(m\.timestamp_seconds\)/.test(live), 'publicMoment must carry ts');
  /* ⚠ ONE definition of hh:mm:ss. The prompt builder had its own inline copy;
     two copies is how the time a manager reads drifts from the time the model
     was given. */
  assert.ok(/function hmsOf\(/.test(live), 'a single helper exists');
  assert.strictEqual((live.match(/padStart\(2, '0'\)/g) || []).length, 1,
    'exactly ONE hh:mm:ss implementation in this lane');
  const page = strip(HTML);
  assert.ok(/var where = m\.ts \? m\.ts/.test(page), 'the renderer PREFERS the timestamp');
  /* ⚠ AND THE PERCENTAGE SURVIVES AS THE FALLBACK. ts is null exactly when the
     duration is unknown, and a rough answer beats "position unknown". */
  assert.ok(/% through the call/.test(page), 'the fallback is still there for calls with no duration');
});

test('⚠⚠ (a) the objections page has NO cards — and the rules are SCOPED to it', () => {
  const live = strip(HTML);
  const rules = ['.objsum-card', '.objsum-ev', '.nw-context'];
  rules.forEach((sel) => {
    const re = new RegExp('body\\[data-view="team-objections"\\] ' + sel.replace('.', '\\.') + '\\s*[,{]');
    assert.ok(re.test(live), sel + ' must be un-carded on this page');
  });
  /* ⚠⚠ SCOPING IS THE WHOLE SAFETY OF THIS CHANGE. .objsum-* and .nw-context are
     SHARED with the personal coaching surfaces, which are NOT in this pass —
     nwContextLineHtml alone has a second call site on the personal rep page.
     An unscoped edit would restyle pages nobody has looked at. */
  const unscoped = new RegExp('\\n\\s*\\.objsum-card\\s*\\{[^}]*border:\\s*0');
  assert.ok(!unscoped.test(live), '⚠ the base .objsum-card must keep its box for the personal surfaces');
});

test('⚠ (a) the ground was already on this page — the sequencing rule holds', () => {
  const live = strip(HTML);
  /* ⚠⚠ THE GROUND GOES ON BEFORE THE CARDS COME OFF. Part 1 removed cards first
     and put 95 of 105 text elements onto the artwork. This page already had the
     ground, which is the only reason un-carding it is safe. */
  assert.ok(/body\[data-view="team-objections"\] \.page\s*[,{]/.test(live),
    'team-objections must have the ground BEFORE its cards are removed');
});

test('⚠⚠ (d) four facts, four treatments — and no return to four boxes', () => {
  const live = strip(HTML);
  const at = live.indexOf('body[data-view="team-objections"] .obj-card-head');
  assert.ok(at > -1, 'the row rules exist');
  const block = live.slice(at, at + 1400);
  assert.ok(/\.obj-closer-chip[^}]*font-weight/.test(block), 'WHO is carried by weight');
  assert.ok(/\.obj-surface[^}]*font-style:\s*italic/.test(block), 'WHAT they said is carried by style');
  assert.ok(/\.scope-pill[^}]*text-transform:\s*uppercase/.test(block), 'WHICH KIND is carried by case');
  /* ⚠ THE FIX IS NOT PUTTING THE BOXES BACK — that is what this pass removes.
     A background on any of these means someone reintroduced the pills. */
  assert.strictEqual(/\.obj-card-head \.(scope-pill|obj-closer-chip|obj-surface)[^}]*background:\s*(?!none)/.test(block), false,
    'no fills — they separate by weight, case and colour, not by a box');
});
